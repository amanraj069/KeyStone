import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import { GraphService } from '../graph/graph.service';
import { LlmService } from '../llm/llm.service';
import {
  AGENT_MODEL,
  AGENT_TOOLS,
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_TASK,
  FINAL_ANSWER_PROMPT,
  MAX_TOOL_RESULT_CHARS,
  NOT_IN_RECORDS,
  QUESTION_LABELS,
  SAYS_NOT_IN_RECORDS,
  type QuestionLabel,
  SYSTEM_PROMPT,
} from './agent.constants';
import type { AgentEvent, AgentMessage, AgentModel, AgentTools, Citation, GraphPath, ToolEnvelope } from './agent.types';
import { checkCitations } from './citations';
import { unionGraphPaths } from './graph-union';
import { CITED_ARTIFACTS } from './queries/agent.queries';

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

/** Thrown when a step would run past the question's time budget. */
class OutOfTime extends Error {}

/**
 * Keystone's question answering agent. It is an MCP client: the tools come from
 * the Keystone MCP server, and the model (OpenAI or Gemini, per USE_OPENAI) picks
 * them. Answers cite artifact ids, and only ids that a tool returned as evidence
 * survive. Nothing about the conversation is stored (memory comes in Stage 16).
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
  ) {}

  /** List the MCP tools once at startup, as soon as the API accepts requests (a failure is retried on first use). */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      this.tools.list().catch((error: unknown) => this.logger.warn(`MCP tools not listed yet: ${String(error)}`));
    }, 1000).unref();
  }

  /** Answers one question, as a stream of events (see AgentEvent). Never throws: failures are an 'error' event. */
  async *run(question: string, sessionId: string): AsyncGenerator<AgentEvent> {
    const started = Date.now();
    const deadline = started + this.settings.budgetMs;
    const timings = { classifyMs: 0, modelMs: 0, toolsMs: 0 };
    const toolsUsed: string[] = [];
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
      label = await this.classify(question);
      timings.classifyMs = Date.now() - t0;
      yield { type: 'classified', label };

      const tools = await this.tools.list();
      const messages: AgentMessage[] = [
        { role: 'user', text: `${question}\n\n(Question type: ${label}. Use it to choose tools; answer the question as asked.)` },
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
          yield { type: 'tool_call', name: call.name, args: call.args };
          const envelope = await this.callTool(call.name, call.args, timings, deadline);
          envelope.evidence.forEach((id) => evidence.add(id));
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
      if ((cited.length === 0 && label !== 'general') || text.length === 0 || SAYS_NOT_IN_RECORDS.test(sentences(text)[0] ?? '')) {
        text = notInRecords(toolsUsed);
        cited = [];
        outcome = 'not_in_records';
      }

      for (const chunk of sentences(text)) yield { type: 'answer_delta', text: chunk };
      citations = await this.lookUpCitations(cited);
      yield {
        type: 'done',
        citations,
        graphPath: unionGraphPaths(graphPaths),
        timings: { ...timings, steps, totalMs: Date.now() - started },
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

  /** One cheap, cached call that labels the question; a failure falls back to 'general'. */
  private async classify(question: string): Promise<QuestionLabel> {
    try {
      const { value } = await this.llm.generateObjectWithUsage(ClassificationSchema, {
        task: CLASSIFY_TASK,
        system: CLASSIFY_SYSTEM_PROMPT,
        prompt: question,
      });
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

  /** Title, type and day of each cited artifact, in citation order (one query). */
  private async lookUpCitations(ids: string[]): Promise<Citation[]> {
    if (ids.length === 0) return [];
    const rows = await this.graph.roQuery<Citation>(this.settings.graph, CITED_ARTIFACTS, { ids });
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
