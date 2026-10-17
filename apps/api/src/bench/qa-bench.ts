import type { QuestionResult, SystemAnswer } from '@keystone/shared';
import { z } from 'zod';
import type { AgentService } from '../agent/agent.service';
import { checkCitations } from '../agent/citations';
import type { GraphService } from '../graph/graph.service';
import type { LlmService } from '../llm/llm.service';
import type { RetrievalService } from '../retrieval/retrieval.service';
import type { Question } from './answer-key';
import {
  BASELINE_SYSTEM_PROMPT,
  BASELINE_TASK,
  EXPECTED_SYSTEM_PROMPT,
  EXPECTED_TASK,
  JUDGE_SYSTEM_PROMPT,
  JUDGE_TASK,
  MAX_AGENT_CALLS,
} from './bench.constants';
import * as Q from './queries/bench.queries';
import {
  blindAnswer,
  evidenceRecall,
  type GoldAnswer,
  goldAnswer,
  goldEvidenceCandidates,
  goldVerdict,
  expectedFromWording,
  judgePrompt,
  leadingVerdict,
  scoreIds,
  scoreName,
} from './scoring';

const BaselineSchema = z.object({ answer: z.string() });
const JudgeSchema = z.object({ verdict: z.enum(['correct', 'incorrect']), reason: z.string() });
const ExpectedSchema = z.object({ answer: z.enum(['yes', 'no', 'unclear']) });

export interface QaBenchDeps {
  agent: Pick<AgentService, 'ask'>;
  retrieval: Pick<RetrievalService, 'vectorOnlySearch'>;
  /** Answers for the baseline: the same model the agent uses. */
  llm: Pick<LlmService, 'generateObjectWithUsage'>;
  /** The judge (BENCH_JUDGE_MODEL, or the same LlmService as `llm`). */
  judge: Pick<LlmService, 'generateObjectWithUsage'>;
  graph: Pick<GraphService, 'roQuery'>;
}

export interface QaBenchSettings {
  /** The company graph (apex). */
  graph: string;
  /** Characters of chunk text the baseline may paste into its prompt. */
  contextBudgetChars: number;
  /** Chunks the baseline asks the vector index for. */
  baselineK: number;
}

/** What scoring needs to know about one question's gold answer (read only after both systems answered). */
export interface QuestionGold {
  answer: GoldAnswer;
  verdict: 'yes' | 'no' | null;
  /** Gold evidence artifact ids that exist in the graph. */
  evidence: string[];
}

/** An answer before it is scored. */
type Unscored = Omit<SystemAnswer, 'correct' | 'reason' | 'evidenceRecall'>;

/**
 * Part B2: the same questions answered by Keystone (the agent, through its MCP
 * tools) and by a vector-only baseline (top-k chunks in one prompt), both with the
 * same model and the same context budget, then scored. Questions run one at a
 * time so latencies are not inflated by each other.
 */
export class QaBench {
  constructor(
    private readonly deps: QaBenchDeps,
    private readonly settings: QaBenchSettings,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** How each question will be scored, its gold yes/no and its gold evidence (two graph lookups for all questions). */
  async goldAnswers(questions: readonly Question[]): Promise<Map<string, QuestionGold>> {
    const answerValues = questions.flatMap((q) => answerStrings(q.ground_truth.answer));
    const evidenceValues = questions.flatMap((q) => goldEvidenceCandidates(q.ground_truth));
    const values = [...new Set([...answerValues, ...evidenceValues])];
    const [ids, names] =
      values.length === 0
        ? [[], []]
        : await Promise.all([
            this.deps.graph.roQuery<{ id: string }>(this.settings.graph, Q.KNOWN_ARTIFACT_IDS, { values }),
            this.deps.graph.roQuery<{ name: string }>(this.settings.graph, Q.KNOWN_PERSON_OR_SYSTEM_NAMES, { values }),
          ]);
    const idSet = new Set(ids.map((r) => r.id));
    const nameSet = new Set(names.map((r) => r.name));
    const known = { isArtifactId: (v: string) => idSet.has(v), isPersonOrSystem: (v: string) => nameSet.has(v) };
    return new Map(
      questions.map((q) => [
        q.question_id,
        {
          answer: goldAnswer(q, known),
          verdict: goldVerdict(q.ground_truth),
          evidence: goldEvidenceCandidates(q.ground_truth).filter((id) => idSet.has(id)),
        },
      ]),
    );
  }

  /** LLM calls run() will make at most: agent runs, baseline answers and query embeddings, one expected-answer and two judge calls. */
  static plannedCalls(gold: ReadonlyMap<string, QuestionGold>): number {
    const judged = [...gold.values()].filter((g) => g.answer.method === 'judge').length;
    return gold.size * (MAX_AGENT_CALLS + 2) + judged * 3;
  }

  /** Expected yes/no answers to the question as worded, one cached call per question (null: unclear or failed). */
  private readonly expected = new Map<string, Promise<'yes' | 'no' | null>>();
  private expectedAnswer(question: Question, gold: QuestionGold): Promise<'yes' | 'no' | null> {
    let answer = this.expected.get(question.question_id);
    // Wording that settles it beats the model (it has misread "would ... still ...").
    const byWording = expectedFromWording(question.question_text, question.ground_truth);
    if (!answer && byWording) answer = Promise.resolve(byWording);
    if (!answer) {
      answer = this.deps.judge
        .generateObjectWithUsage(ExpectedSchema, {
          task: EXPECTED_TASK,
          system: EXPECTED_SYSTEM_PROMPT,
          prompt: `Question:\n${question.question_text}\n\nCorrect conclusion:\n${gold.answer.text}`,
        })
        .then((r) => (r.value.answer === 'unclear' ? null : r.value.answer))
        .catch(() => null);
      this.expected.set(question.question_id, answer);
    }
    return answer;
  }

  async run(questions: readonly Question[], gold: ReadonlyMap<string, QuestionGold>): Promise<QuestionResult[]> {
    const results: QuestionResult[] = [];
    for (const [index, question] of questions.entries()) {
      const { keystone, baseline } = await this.answerBoth(question, index % 2 === 0);
      const g = gold.get(question.question_id)!;
      const [k, b] = await Promise.all([this.score(question, g, keystone), this.score(question, g, baseline)]);
      results.push({
        id: question.question_id,
        type: question.question_type,
        difficulty: question.difficulty ?? null,
        question: question.question_text,
        method: g.answer.method,
        gold: g.answer.text,
        goldVerdict: g.verdict,
        goldEvidence: g.evidence,
        keystone: k,
        baseline: b,
      });
      this.log(
        `B2 ${index + 1}/${questions.length} ${question.question_type} ${question.question_id}: ` +
          `keystone ${mark(k.correct)} (${k.latencyMs} ms, ${k.steps} steps, recall ${pct(k.evidenceRecall)}), ` +
          `baseline ${mark(b.correct)} (${b.latencyMs} ms, recall ${pct(b.evidenceRecall)})`,
      );
    }
    return results;
  }

  /** Both systems, one after the other; the caller alternates who goes first, so neither always meets a cold (or warm) provider. */
  private async answerBoth(question: Question, keystoneFirst: boolean): Promise<{ keystone: Unscored; baseline: Unscored }> {
    if (keystoneFirst) {
      const keystone = await this.keystone(question);
      return { keystone, baseline: await this.baseline(question) };
    }
    const baseline = await this.baseline(question);
    return { keystone: await this.keystone(question), baseline };
  }

  /** Keystone: AgentService in non-streaming mode, with only the question text. */
  private async keystone(question: Question): Promise<Unscored> {
    const started = performance.now();
    try {
      const result = await this.deps.agent.ask(question.question_text, `bench-${question.question_id}`);
      return {
        answer: result.answer,
        citedIds: result.citations.map((c) => c.id),
        toolsUsed: result.toolsUsed,
        toolCalls: result.toolCalls,
        retrieved: result.evidence,
        steps: result.steps,
        latencyMs: Math.round(performance.now() - started),
        cached: false,
        usage: result.usage,
        error: result.error,
      };
    } catch (error) {
      return failed(started, error);
    }
  }

  /**
   * Baseline: vectorOnlySearch's top-k chunks pasted into one prompt until the
   * context budget is full; "answer only from these documents and cite ids".
   * Citations go through the agent's own guardrail, against the pasted ids.
   */
  private async baseline(question: Question): Promise<Unscored> {
    const started = performance.now();
    try {
      const search = await this.deps.retrieval.vectorOnlySearch(this.settings.graph, { q: question.question_text, k: this.settings.baselineK });
      const documents: string[] = [];
      const shown = new Set<string>();
      let used = 0;
      for (const hit of search.hits) {
        const block = `[${hit.artifactId}]\n${hit.text}`;
        if (used + block.length > this.settings.contextBudgetChars) break;
        documents.push(block);
        shown.add(hit.artifactId);
        used += block.length;
      }
      const { value, usage, cached } = await this.deps.llm.generateObjectWithUsage(BaselineSchema, {
        task: BASELINE_TASK,
        system: BASELINE_SYSTEM_PROMPT,
        prompt: `Documents:\n\n${documents.join('\n\n---\n\n')}\n\nQuestion: ${question.question_text}`,
      });
      const checked = checkCitations(value.answer, shown);
      return {
        answer: checked.text,
        citedIds: checked.valid,
        toolsUsed: ['vector_only_search'],
        toolCalls: [],
        retrieved: [...shown],
        steps: 1,
        latencyMs: Math.round(performance.now() - started),
        cached,
        usage,
        error: null,
      };
    } catch (error) {
      return failed(started, error);
    }
  }

  /**
   * Scores a stored answer again (pnpm bench --rejudge): the same rules as a run, with
   * the current judge, so a judge fix does not need both systems to answer again.
   */
  rescore(question: Question, gold: QuestionGold, answer: SystemAnswer): Promise<SystemAnswer> {
    const unscored: Unscored = {
      answer: answer.answer,
      citedIds: answer.citedIds,
      toolsUsed: answer.toolsUsed,
      toolCalls: answer.toolCalls,
      retrieved: answer.retrieved,
      steps: answer.steps,
      latencyMs: answer.latencyMs,
      cached: answer.cached,
      usage: answer.usage,
      error: answer.error,
    };
    return this.score(question, gold, unscored);
  }

  /** Ids: exact match on cited ids. Names: normalised match. Otherwise the blinded judge. A failed run is wrong. */
  private async score(question: Question, gold: QuestionGold, answer: Unscored): Promise<SystemAnswer> {
    const scored = { ...answer, evidenceRecall: evidenceRecall(gold.evidence, answer.retrieved) };
    if (answer.error !== null) return { ...scored, correct: false, reason: `no answer: ${answer.error}` };
    if (gold.answer.method === 'ids') return { ...scored, ...scoreIds(gold.answer.ids, answer.citedIds) };
    if (gold.answer.method === 'name') return { ...scored, ...scoreName(gold.answer.name, answer.answer) };
    // A yes/no question, answered with a leading Yes or No: compare it with the expected answer.
    const opens = gold.verdict !== null ? leadingVerdict(answer.answer) : null;
    const expected = opens ? await this.expectedAnswer(question, gold) : null;
    if (opens && expected) {
      return { ...scored, correct: opens === expected, reason: `opens with "${opens}"; the correct answer to the question as worded is "${expected}"` };
    }
    try {
      const { verdict, reason } = await this.deps.judge
        .generateObjectWithUsage(JudgeSchema, {
          task: JUDGE_TASK,
          system: JUDGE_SYSTEM_PROMPT,
          prompt: judgePrompt(question.question_text, gold.answer.text, blindAnswer(answer.answer)),
        })
        .then((r) => r.value);
      return { ...scored, correct: verdict === 'correct', reason: oneLine(reason) };
    } catch (error) {
      return { ...scored, correct: null, reason: `judge failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

/** The string value(s) of a ground-truth answer, if it has any (booleans have none). */
function answerStrings(answer: unknown): string[] {
  if (typeof answer === 'string') return [answer];
  return Array.isArray(answer) ? answer.filter((v): v is string => typeof v === 'string') : [];
}

function failed(started: number, error: unknown): Unscored {
  return {
    answer: '',
    citedIds: [],
    toolsUsed: [],
    toolCalls: [],
    retrieved: [],
    steps: 0,
    latencyMs: Math.round(performance.now() - started),
    cached: false,
    usage: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mark(correct: boolean | null): string {
  return correct === null ? '?' : correct ? 'correct' : 'wrong';
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}
