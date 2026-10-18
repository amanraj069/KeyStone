import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { z } from 'zod';
import { GraphService } from '../graph/graph.service';
import { LlmService } from '../llm/llm.service';
import { type LlmTokenUsage, NO_TOKENS } from '../llm/llm.types';
import { AGENT_MEMORY, NOTE_ID_PREFIX } from '../memory/memory.constants';
import { type AgentMemory, EMPTY_CONTEXT, type MemoryContext, type PriorTurn } from '../memory/memory.service';
import {
  AGENT_MODEL,
  AGENT_TOOLS,
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_TASK,
  FINAL_ANSWER_PROMPT,
  LABEL_HINTS,
  MAX_TOOL_RESULT_CHARS,
  NOT_IN_RECORDS,
  QUESTION_LABELS,
  SAYS_NOT_IN_RECORDS,
  STARTS_WITH_VERDICT,
  type QuestionLabel,
  SYSTEM_PROMPT,
} from './agent.constants';
import type { AgentEvent, AgentMessage, AgentModel, AgentTools, Citation, GraphPath, ToolEnvelope } from './agent.types';
import { checkCitations } from './citations';
import { unionGraphPaths } from './graph-union';
import { CITED_ARTIFACTS, CITED_NOTES } from './queries/agent.queries';

/** Injection token for agent settings. */
export const AGENT_SETTINGS = Symbol('AGENT_SETTINGS');

export interface AgentSettings {
  /** The graph citations are looked up in (apex). */
  graph: string;
  maxSteps: number;
  budgetMs: number;
  finalAnswerGraceMs: number;
}

const ClassificationSchema = z.object({ label: z.enum(QUESTION_LABELS) });

export interface RunOptions {
  /** Called with the token usage of every LLM call the run makes (classification and model steps). */
  onUsage?: (usage: LlmTokenUsage) => void;
  /** Called with the evidence ids of every tool result (what the model had in front of it). */
  onEvidence?: (ids: string[]) => void;
  /** Who asks (the browser's anonymous id): stored with the turn so each user's chats stay theirs. */
  userId?: string;
}

/** One question answered without streaming (AgentService.ask): what the event stream adds up to. */
export interface AgentAnswer {
  label: QuestionLabel;
  /** The answer after the citation guardrail. */
  answer: string;
  citations: Citation[];
  /** Tool names in call order (a tool called twice appears twice). */
  toolsUsed: string[];
  /** The same calls with their arguments. */
  toolCalls: { name: string; args: Record<string, unknown> }[];
  /** Every artifact id the tools returned as evidence, first-seen order. */
  evidence: string[];
  steps: number;
  timings: Record<string, number>;
  /** Summed over every LLM call of the run; zeros when the SDK reports nothing (or the call was cached). */
  usage: LlmTokenUsage;
  /** The run failed; `answer` is empty then. */
  error: string | null;
}

/** Thrown when a step would run past the question's time budget. */
class OutOfTime extends Error {}

/**
 * Keystone's question answering agent. It is an MCP client: the tools come from
 * the Keystone MCP server, and the model (OpenAI or Gemini, per USE_OPENAI) picks
 * them. Answers cite artifact ids, and only ids that a tool returned as evidence
 * survive. With memory (Stage 16), each answer is stored as a Turn of its chat:
 * a follow-up sees the earlier turns, and approved notes about the question's
 * systems and people are added to it and can be cited like artifacts.
 */
@Injectable()
export class AgentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentService.name);
  /** The model's last answer before the guardrail (for the `pnpm ask --raw` diagnostics). */
  lastRawAnswer: string | null = null;

  constructor(
    @Inject(AGENT_MODEL) private readonly model: AgentModel,
    @Inject(AGENT_TOOLS) private readonly tools: AgentTools,
    private readonly llm: LlmService,
    private readonly graph: GraphService,
    @Inject(AGENT_SETTINGS) private readonly settings: AgentSettings,
    /** Absent in the benchmark and the CLI: then every question is answered on its own and nothing is stored. */
    @Optional() @Inject(AGENT_MEMORY) private readonly memory?: AgentMemory,
  ) {}

  /** List the MCP tools once at startup, as soon as the API accepts requests (a failure is retried on first use). */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      this.tools.list().catch((error: unknown) => this.logger.warn(`MCP tools not listed yet: ${String(error)}`));
    }, 1000).unref();
  }

  /** Answers one question, as a stream of events (see AgentEvent). Never throws: failures are an 'error' event. */
  async *run(question: string, sessionId: string, options: RunOptions = {}): AsyncGenerator<AgentEvent> {
    const started = Date.now();
    const deadline = started + this.settings.budgetMs;
    const timings = { classifyMs: 0, modelMs: 0, toolsMs: 0 };
    const toolsUsed: string[] = [];
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    const evidence = new Set<string>();
    const graphPaths: GraphPath[] = [];
    let label: QuestionLabel = 'general';
    let steps = 0;
    let forced = false;
    let dropped: string[] = [];
    let citations: Citation[] = [];
    let outcome = 'answered';

    try {
      const t0 = Date.now();
      // Memory is read while the question is classified; a failure there means no memory, never no answer.
      const recalled = this.recall(sessionId, question);
      label = await this.classify(question, options);
      timings.classifyMs = Date.now() - t0;
      yield { type: 'classified', label };

      const memory = await recalled;
      if (memory.priorTurns.length > 0 || memory.notes.length > 0) {
        yield { type: 'memory', priorTurns: memory.priorTurns.length, notes: memory.notes.map((n) => ({ id: n.id, text: n.text })), subjects: memory.subjects };
      }
      // Earlier answers of this chat passed the guardrail, so their citations stay valid; notes are cited by id.
      memory.priorTurns.forEach((turn) => turn.cited.forEach((id) => evidence.add(id)));
      memory.notes.forEach((note) => evidence.add(note.id));

      const tools = await this.tools.list();
      const messages: AgentMessage[] = [
        ...priorMessages(memory.priorTurns),
        { role: 'user', text: withMemory(withHint(question, label), memory) },
      ];
      let answer: string | null = null;

      // The loop: model call -> tool calls -> results -> model call ..., until it answers or a limit is hit.
      while (answer === null) {
        if (steps >= this.settings.maxSteps || Date.now() >= deadline) {
          forced = true;
          break;
        }
        let turn;
        try {
          turn = await this.timed(timings, 'modelMs', (signal) =>
            this.model.step({ system: SYSTEM_PROMPT, messages, tools, allowTools: true, signal }), deadline);
        } catch (error) {
          if (!(error instanceof OutOfTime)) throw error;
          forced = true;
          break;
        }
        if (turn.usage) options.onUsage?.(turn.usage);
        if (turn.toolCalls.length === 0) {
          answer = turn.text ?? '';
          break;
        }
        messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw });
        for (const call of turn.toolCalls) {
          // Every call the model made needs a result, also the ones a limit stops.
          if (steps >= this.settings.maxSteps || Date.now() >= deadline) {
            messages.push({ role: 'tool', callId: call.id, name: call.name, content: JSON.stringify({ error: 'Not run: the tool limit for this question was reached.' }) });
            continue;
          }
          steps++;
          toolsUsed.push(call.name);
          toolCalls.push({ name: call.name, args: call.args });
          yield { type: 'tool_call', name: call.name, args: call.args };
          const envelope = await this.callTool(call.name, call.args, timings, deadline);
          envelope.evidence.forEach((id) => evidence.add(id));
          options.onEvidence?.(envelope.evidence);
          if (envelope.graphPath) graphPaths.push(envelope.graphPath);
          yield {
            type: 'tool_result',
            name: call.name,
            summary: summarize(envelope),
            evidenceCount: envelope.evidence.length,
            graphPath: envelope.graphPath ?? null,
          };
          messages.push({ role: 'tool', callId: call.id, name: call.name, content: forModel(envelope) });
        }
      }

      // A limit was hit: one more call, without tools, to answer from what was found.
      if (answer === null) {
        messages.push({ role: 'user', text: FINAL_ANSWER_PROMPT });
        const finalDeadline = Math.max(deadline, Date.now()) + this.settings.finalAnswerGraceMs;
        const turn = await this.timed(timings, 'modelMs', (signal) =>
          this.model.step({ system: SYSTEM_PROMPT, messages, tools, allowTools: false, signal }), finalDeadline);
        if (turn.usage) options.onUsage?.(turn.usage);
        answer = turn.text ?? '';
      }

      // Guardrail: only citations backed by tool evidence survive.
      this.lastRawAnswer = answer;
      const checked = checkCitations(answer, evidence);
      dropped = checked.dropped;
      for (const id of dropped) this.logger.warn(JSON.stringify({ event: 'hallucinated_citation', sessionId, id }));
      let text = checked.text;
      let cited = checked.valid;
      // A refusal is a refusal: the standard message, without citations that would make it look sourced.
      const refuses = !STARTS_WITH_VERDICT.test(text) && SAYS_NOT_IN_RECORDS.test(sentences(text)[0] ?? '');
      if ((cited.length === 0 && label !== 'general') || text.length === 0 || refuses) {
        text = notInRecords(toolsUsed);
        cited = [];
        outcome = 'not_in_records';
      }

      for (const chunk of sentences(text)) yield { type: 'answer_delta', text: chunk };
      citations = await this.lookUpCitations(cited);
      const turnId = await this.remember({
        userId: options.userId,
        sessionId,
        question,
        answer: text,
        label,
        outcome,
        toolCalls,
        cited: cited.filter((id) => !id.startsWith(NOTE_ID_PREFIX)),
        latencyMs: Date.now() - started,
      });
      yield {
        type: 'done',
        citations,
        graphPath: unionGraphPaths(graphPaths),
        timings: { ...timings, steps, totalMs: Date.now() - started },
        turnId,
      };
    } catch (error) {
      outcome = 'error';
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', message };
    } finally {
      this.logger.log(
        JSON.stringify({
          event: 'agent_run',
          sessionId,
          question,
          label,
          provider: this.model.provider,
          model: this.model.model,
          tools: toolsUsed,
          steps,
          forcedFinalAnswer: forced,
          citations: citations.length,
          droppedCitations: dropped,
          outcome,
          latencyMs: Date.now() - started,
        }),
      );
    }
  }

  /**
   * Non-streaming mode: runs the same loop as run() to the end and returns the
   * answer, citations, tools, steps, timings and token usage in one object.
   */
  async ask(question: string, sessionId: string): Promise<AgentAnswer> {
    const usage: LlmTokenUsage = { ...NO_TOKENS };
    const evidence = new Set<string>();
    const result: AgentAnswer = { label: 'general', answer: '', citations: [], toolsUsed: [], toolCalls: [], evidence: [], steps: 0, timings: {}, usage, error: null };
    const onUsage = (add: LlmTokenUsage) => {
      for (const field of Object.keys(usage) as (keyof LlmTokenUsage)[]) usage[field] += add[field] ?? 0;
    };
    const onEvidence = (ids: string[]) => ids.forEach((id) => evidence.add(id));
    for await (const event of this.run(question, sessionId, { onUsage, onEvidence })) {
      if (event.type === 'classified') result.label = event.label;
      else if (event.type === 'tool_call') {
        result.toolsUsed.push(event.name);
        result.toolCalls.push({ name: event.name, args: event.args });
      }
      else if (event.type === 'answer_delta') result.answer += event.text;
      else if (event.type === 'done') {
        result.citations = event.citations;
        result.timings = event.timings;
        result.steps = event.timings.steps ?? 0;
      } else if (event.type === 'error') result.error = event.message;
    }
    result.evidence = [...evidence];
    return result;
  }

  /** One cheap, cached call that labels the question; a failure falls back to 'general'. */
  private async classify(question: string, options: RunOptions): Promise<QuestionLabel> {
    try {
      const { value, usage } = await this.llm.generateObjectWithUsage(ClassificationSchema, {
        task: CLASSIFY_TASK,
        system: CLASSIFY_SYSTEM_PROMPT,
        prompt: question,
      });
      options.onUsage?.(usage);
      return value.label;
    } catch (error) {
      this.logger.warn(`Classification failed, using "general": ${String(error)}`);
      return 'general';
    }
  }

  /** Calls a tool through MCP; a failure becomes an error envelope the model can read. */
  private async callTool(name: string, args: Record<string, unknown>, timings: Record<string, number>, deadline: number): Promise<ToolEnvelope> {
    try {
      const { envelope } = await this.timed(timings, 'toolsMs', () => this.tools.call(name, args), deadline);
      return envelope;
    } catch (error) {
      const message = error instanceof OutOfTime ? 'Not finished within the time budget.' : error instanceof Error ? error.message : String(error);
      return { data: null, evidence: [], error: message };
    }
  }

  /** Runs `work` but gives up at `deadline` (aborting it); adds the time to timings[key]. */
  private async timed<T>(timings: Record<string, number>, key: string, work: (signal: AbortSignal) => Promise<T>, deadline: number): Promise<T> {
    const started = Date.now();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new OutOfTime());
          }, Math.max(0, deadline - Date.now()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
      timings[key] += Date.now() - started;
    }
  }

  /** The chat so far and approved notes on the question's subjects; no memory (or a failure) gives none. */
  private async recall(sessionId: string, question: string): Promise<MemoryContext> {
    if (!this.memory) return EMPTY_CONTEXT;
    try {
      return await this.memory.contextFor(sessionId, question);
    } catch (error) {
      this.logger.warn(`Memory not read, answering without it: ${String(error)}`);
      return EMPTY_CONTEXT;
    }
  }

  /** Stores the answered question as a Turn; returns its id, or null without memory or on a failure. */
  private async remember(turn: Parameters<AgentMemory['recordTurn']>[0]): Promise<string | null> {
    if (!this.memory) return null;
    try {
      return await this.memory.recordTurn(turn);
    } catch (error) {
      this.logger.warn(`Turn not stored: ${String(error)}`);
      return null;
    }
  }

  /** Title, type and day of each cited artifact or note, in citation order. */
  private async lookUpCitations(ids: string[]): Promise<Citation[]> {
    if (ids.length === 0) return [];
    const noteIds = ids.filter((id) => id.startsWith(NOTE_ID_PREFIX));
    const rows = [
      ...(await this.graph.roQuery<Citation>(this.settings.graph, CITED_ARTIFACTS, { ids })),
      ...(noteIds.length > 0 ? await this.graph.roQuery<Citation>(this.settings.graph, CITED_NOTES, { ids: noteIds }) : []),
    ];
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id) ?? { id, title: null, type: null, day: null });
  }
}

/** What the model sees of a tool result: data, evidence and any error; never graphPath; cut to a sane size. */
export function forModel(envelope: ToolEnvelope): string {
  const text = JSON.stringify({ data: envelope.data, evidence: envelope.evidence, ...(envelope.error ? { error: envelope.error } : {}) });
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… (truncated)` : text;
}

/** One line for the UI: list sizes, totals, not-found suggestions, or the error. */
export function summarize(envelope: ToolEnvelope): string {
  if (envelope.error) return `error: ${envelope.error}`;
  const data = envelope.data;
  if (!data || typeof data !== 'object') return `${envelope.evidence.length} evidence ids`;
  const record = data as Record<string, unknown>;
  if (record.found === false && Array.isArray(record.suggestions)) return `not found; did you mean ${(record.suggestions as string[]).join(', ')}`;
  const parts = Object.entries(record).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [`${key}: ${value.length}`];
    if (value && typeof value === 'object' && 'total' in value) return [`${key}: ${String((value as { total: unknown }).total)}`];
    if (value && typeof value === 'object' && key === 'counts') return [Object.entries(value).map(([k, v]) => `${k} ${String(v)}`).join(', ')];
    return [];
  });
  return parts.length > 0 ? parts.join('; ') : `${envelope.evidence.length} evidence ids`;
}

/** The question as the model sees it: with its type and, for some types, how to use the tools. */
export function withHint(question: string, label: QuestionLabel): string {
  const hint = LABEL_HINTS[label];
  return `${question}\n\n(Question type: ${label}. ${hint ?? 'Use it to choose tools; answer the question as asked.'})`;
}

/** Earlier turns of the chat as the conversation the model sees: each question and the start of its answer. */
export function priorMessages(turns: PriorTurn[]): AgentMessage[] {
  return turns.flatMap((turn): AgentMessage[] => [
    { role: 'user', text: turn.question },
    { role: 'assistant', text: turn.summary, toolCalls: [] },
  ]);
}

/**
 * The question with the approved notes about its subjects, if any. Notes are newer
 * than some documents (a change of owner, a correction), so the model may cite them
 * and must give both when one contradicts the documents.
 */
export function withMemory(text: string, memory: MemoryContext): string {
  if (memory.notes.length === 0) return text;
  const notes = memory.notes.map((note) => `- [${note.id}] ${note.text}`).join('\n');
  return (
    `${text}\n\nApproved notes from colleagues about ${memory.subjects.join(', ')}. They can be newer than the documents: cite ` +
    `them by id like an artifact, and if one contradicts the documents, give both.\n${notes}`
  );
}

/** The fallback answer when nothing in the records supports one. */
export function notInRecords(toolsUsed: string[]): string {
  const tried = [...new Set(toolsUsed)];
  return tried.length > 0 ? `${NOT_IN_RECORDS} Tools tried: ${tried.join(', ')}.` : `${NOT_IN_RECORDS} No tools were tried.`;
}

/**
 * The answer in sentence-sized pieces for answer_delta events; concatenated they
 * give the answer back. A sentence ends at . ! or ? followed by a space or the end
 * (so "100.47" stays whole), with its citations; or at a line break.
 */
export function sentences(text: string): string[] {
  return text.match(/[\s\S]*?(?:[.!?]+(?:\s*\[[^\]\n]*\])*(?=\s|$)|\n+|$)\s*/g)?.filter((s) => s.length > 0) ?? [];
}
