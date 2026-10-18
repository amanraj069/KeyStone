/**
 * Stage 13 benchmark: `pnpm bench` (FalkorDB must be running; the API need not be,
 * the agent's MCP tools run in this process over an in-memory transport).
 *
 *   pnpm bench                 B1 (departure prediction) and B2 (question answering)
 *   pnpm bench --only=b1       just B1 (or --only=b2); the other part of an existing results.json is kept
 *   pnpm bench --yes           do not ask before more than 1,500 LLM calls
 *   pnpm bench --dry-run       inspect, plan and print the cost estimate, then stop
 *   pnpm bench --out=mini      write data/bench/mini.json and mini.md instead of results.*
 *   pnpm bench --rejudge       score the stored B2 answers again with the current judge (no system answers again)
 *   pnpm bench --publish=name  copy data/bench/name.json to apps/api/bench-results/ (what the site shows; no LLM calls)
 * A run without --out also updates apps/api/bench-results/: commit it and the deployed site shows the run.
 *
 * BENCH_PER_TYPE (default 15) and BENCH_SEED (default 13) choose the B2 sample;
 * BENCH_JUDGE_MODEL (optional, same provider) gives the judge and B1's name checks their
 * own model; by default they use the same model as the systems under test.
 * Writes data/bench/results.json and results.md (served by GET /bench/results).
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { B1ResultsSchema, B2ResultsSchema, type BenchResults, type QuestionResult, QuestionResultSchema, SystemAnswerSchema } from '@keystone/shared';
import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { BUDGET_MS, FINAL_ANSWER_GRACE_MS, MAX_STEPS } from '../src/agent/agent.constants';
import { AgentService } from '../src/agent/agent.service';
import type { AgentModel } from '../src/agent/agent.types';
import { McpToolClient } from '../src/agent/mcp-tool-client';
import { GeminiAgentModel } from '../src/agent/models/gemini-agent.model';
import { OpenAiAgentModel } from '../src/agent/models/openai-agent.model';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import { PROJECTION_GRAPH } from '../src/analytics/analytics.constants';
import { inspectQuestions, type Question, readDepartures, readQuestions } from '../src/bench/answer-key';
import { BASELINE_K, checkerModel, CONFIRM_ABOVE_CALLS, CONTEXT_BUDGET_CHARS, DEFAULT_PER_TYPE, DEFAULT_SEED } from '../src/bench/bench.constants';
import { type B1Plan, DepartureBench } from '../src/bench/departure-bench';
import { QaBench } from '../src/bench/qa-bench';
import { renderMarkdown, summarizeQuestions } from '../src/bench/report';
import { publishResults, resultsPaths, writeResults } from '../src/bench/results-store';
import { samplePerType } from '../src/bench/sampling';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { APEX_GRAPH } from '../src/graph/graph.constants';
import { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';
import { createKeystoneMcpServer } from '../src/mcp/keystone-mcp-server';
import { ProjectionService } from '../src/projection/projection.service';
import { embedModelName } from '../src/retrieval/retrieval.module';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import { SCRATCH_PREFIX } from '../src/whatif/whatif.constants';
import { WhatIfService } from '../src/whatif/whatif.service';

const log = (line: string) => console.log(line);

/** Counts the agent's model calls (LlmService counts everything else). */
class CountingModel implements AgentModel {
  calls = 0;
  constructor(private readonly inner: AgentModel) {}
  get provider() {
    return this.inner.provider;
  }
  get model() {
    return this.inner.model;
  }
  step(input: Parameters<AgentModel['step']>[0]) {
    this.calls++;
    return this.inner.step(input);
  }
}

/** A whole number from env, or the default. */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

/**
 * The parts of the previous results.json a partial run keeps (--only=b1 keeps B2 and
 * the reverse), re-validated; B2's summary is recomputed from its per-question results.
 * A part that no longer fits the schema is dropped with a warning.
 */
async function previousResults(dataDir: string, name?: string): Promise<{ b1: BenchResults['b1']; b2: BenchResults['b2']; llmCalls: BenchResults['llmCalls'] | null }> {
  let raw: { b1?: unknown; b2?: { questions?: unknown } | null; llmCalls?: BenchResults['llmCalls'] };
  try {
    raw = JSON.parse(await readFile(resultsPaths(dataDir, name).json, 'utf8'));
  } catch {
    return { b1: null, b2: null, llmCalls: null };
  }
  const b1 = B1ResultsSchema.safeParse(raw.b1);
  const questions = B2ResultsSchema.shape.questions.safeParse(raw.b2?.questions);
  const b2 = questions.success ? B2ResultsSchema.safeParse({ ...raw.b2, ...summarizeQuestions(questions.data) }) : null;
  if (raw.b1 && !b1.success) log('Previous B1 results do not fit the current schema; dropped.');
  if (raw.b2 && !b2?.success) log('Previous B2 results do not fit the current schema; dropped.');
  return { b1: b1.success ? b1.data : null, b2: b2?.success ? b2.data : null, llmCalls: raw.llmCalls ?? null };
}

/**
 * Scores the stored B2 answers of a results file again with the current judge and
 * scoring rules, then rewrites it. Files from older runs are upgraded: fields they
 * lack get empty defaults, and gold verdicts and evidence are read again. B1 is kept.
 */
async function rejudge(
  dataDir: string,
  out: string | undefined,
  qaBench: QaBench,
  questions: Question[],
  judgeCalls: () => { made: number; cacheHits: number },
  judgeModel: string,
): Promise<void> {
  const path = resultsPaths(dataDir, out).json;
  const raw = JSON.parse(await readFile(path, 'utf8')) as BenchResults & { b2: { questions: Record<string, unknown>[] } | null };
  if (!raw.b2?.questions?.length) throw new Error(`${path} has no B2 answers to re-judge`);
  const byId = new Map(questions.map((q) => [q.question_id, q]));
  const stored = raw.b2.questions.map((s) => {
    const question = byId.get(String(s.id));
    if (!question) throw new Error(`Question ${String(s.id)} is not in questions.jsonl`);
    return { stored: s, question };
  });
  const gold = await qaBench.goldAnswers(stored.map((s) => s.question));
  const upgrade = (answer: unknown) => SystemAnswerSchema.parse({ toolCalls: [], retrieved: [], evidenceRecall: null, ...(answer as object) });
  const results: QuestionResult[] = [];
  for (const { stored: s, question } of stored) {
    const g = gold.get(question.question_id)!;
    // A file from before evidence was recorded has no `retrieved`: its recall is unknown, not 0.
    const rescore = async (answer: unknown) => {
      const scored = await qaBench.rescore(question, g, upgrade(answer));
      return answer && typeof answer === 'object' && 'retrieved' in answer ? scored : { ...scored, evidenceRecall: null };
    };
    const [keystone, baseline] = await Promise.all([rescore(s.keystone), rescore(s.baseline)]);
    results.push(QuestionResultSchema.parse({ ...s, method: g.answer.method, gold: g.answer.text, goldVerdict: g.verdict, goldEvidence: g.evidence, keystone, baseline }));
  }
  const b1 = B1ResultsSchema.safeParse(raw.b1);
  if (raw.b1 && !b1.success) log('B1 results in this file do not fit the current schema; dropped.');
  const calls = judgeCalls();
  const rescored: BenchResults = {
    ...raw,
    rejudgedAt: new Date().toISOString(),
    judgeModel,
    llmCalls: { ...raw.llmCalls, made: raw.llmCalls.made + calls.made, cacheHits: raw.llmCalls.cacheHits + calls.cacheHits },
    b1: b1.success ? b1.data : null,
    b2: { ...raw.b2, questions: results, ...summarizeQuestions(results) } as BenchResults['b2'],
  };
  const markdown = renderMarkdown(rescored);
  const paths = await writeResults(dataDir, rescored, markdown, out);
  if (out === undefined) await publishResults(rescored, markdown);
  log(`\n${markdown}`);
  log(`Re-judged ${results.length} questions (${calls.made} judge calls, ${calls.cacheHits} cached); wrote ${paths.json} and ${paths.md}`);
}

/**
 * Publishes a stored run (data/bench/<name>.json) as the site's results: validated,
 * B2's summary recomputed, B1 kept from the current results when the run has none
 * (a --only=b2 run), the report rendered again; written to data/bench/results.* and to
 * the tracked apps/api/bench-results/. No database and no LLM calls.
 */
async function publishRun(dataDir: string, name: string): Promise<void> {
  const run = await previousResults(dataDir, name);
  if (!run.b2 && !run.b1) throw new Error(`${resultsPaths(dataDir, name).json} has no results to publish`);
  const raw = JSON.parse(await readFile(resultsPaths(dataDir, name).json, 'utf8')) as BenchResults;
  const current = name === 'results' ? run : await previousResults(dataDir);
  const results: BenchResults = { ...raw, b1: run.b1 ?? current.b1, b2: run.b2 ?? current.b2 };
  if (!run.b1 && current.b1) log('This run has no B1 (departure prediction): B1 is kept from the current results.json.');
  const markdown = renderMarkdown(results);
  const paths = await writeResults(dataDir, results, markdown);
  const published = await publishResults(results, markdown);
  log(`Published ${name}: wrote ${paths.json} and ${published.json}. Commit apps/api/bench-results/ to show it on the deployed site.`);
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  // The services log every query at debug level; keep the bench's own report readable.
  Logger.overrideLogger(['warn', 'error']);
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  if (only !== null && only !== 'b1' && only !== 'b2') throw new Error('--only must be b1 or b2');
  const runB1 = only !== 'b2';
  const runB2 = only !== 'b1';
  const out = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? undefined;
  if (out !== undefined && !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(out)) throw new Error('--out must be a short name: letters, digits, - and _');
  const perType = intFromEnv('BENCH_PER_TYPE', DEFAULT_PER_TYPE);
  const seed = intFromEnv('BENCH_SEED', DEFAULT_SEED);

  const publish = args.find((a) => a.startsWith('--publish='))?.slice('--publish='.length);
  if (publish !== undefined) {
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(publish)) throw new Error('--publish must name a run in data/bench, e.g. --publish=results');
    await publishRun(env.DATA_DIR, publish);
    return;
  }

  // --- Services, built by hand like scripts/ask.ts (tsx has no decorator metadata for Nest DI).
  const graph = new GraphService(falkorSettingsFromEnv(env));
  await graph.connect(5);
  const llmSettings = llmSettingsFromEnv(env);
  const llm = new LlmService(llmSettings);
  llm.onModuleInit();
  // The checker (judge and B1 name checks): BENCH_JUDGE_MODEL, else the system model; same provider and cache.
  const systemModel = llmSettings.provider === 'openai' ? llmSettings.openai.model : llmSettings.gemini.model;
  const judgeModelName = checkerModel(process.env.BENCH_JUDGE_MODEL, systemModel);
  const judge =
    judgeModelName !== systemModel
      ? new LlmService({
          ...llmSettings,
          openai: { ...llmSettings.openai, model: judgeModelName },
          gemini: { ...llmSettings.gemini, model: judgeModelName },
        })
      : llm;
  const embedModel = embedModelName({ useOpenai: env.USE_OPENAI, openai: env.OPENAI_EMBED_MODEL, gemini: env.GEMINI_EMBED_MODEL });
  const textStore = new LocalTextStore(env.DATA_DIR);
  const retrieval = new RetrievalService(graph, new SchemaService(graph, env.EMBED_DIM), llm, textStore, {
    embedDim: env.EMBED_DIM,
    memoryWarnMb: env.MEMORY_WARN_MB,
    embedModel,
  });
  const analytics = new AnalyticsService(graph);
  const projection = new ProjectionService(graph);
  const whatIf = new WhatIfService(graph, analytics, projection, {
    maxConcurrent: env.WHATIF_MAX_CONCURRENT,
    sourceGraph: APEX_GRAPH,
    projectionGraph: PROJECTION_GRAPH,
    scratchPrefix: SCRATCH_PREFIX,
  });
  // No memory here on purpose: the agent below gets no AGENT_MEMORY and the MCP server no recall_memory, so every
  // question is answered on its own and no Turn or Note is written (one question can never see another's answer).
  // Proposing an action writes an Action node into apex: refused while benchmarking, so a run leaves no trace.
  const refuse = async (): Promise<never> => {
    throw new Error('Proposing actions is disabled during the benchmark.');
  };
  const tools = new McpToolClient(() => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    void createKeystoneMcpServer({
      analytics,
      retrieval,
      whatIf,
      artifacts: new ArtifactsService(graph, textStore),
      actions: { draftHandover: refuse, proposeReassignment: refuse, createRunbookTask: refuse },
    }).connect(server);
    return client;
  });
  const model = new CountingModel(
    llmSettings.provider === 'openai'
      ? new OpenAiAgentModel(llmSettings.openai.apiKey ?? '', llmSettings.openai.model, env.AGENT_REASONING_EFFORT)
      : new GeminiAgentModel(llmSettings.gemini.apiKeys, llmSettings.gemini.model),
  );
  const agent = new AgentService(model, tools, llm, graph, {
    graph: APEX_GRAPH,
    maxSteps: MAX_STEPS,
    budgetMs: BUDGET_MS,
    finalAnswerGraceMs: FINAL_ANSWER_GRACE_MS,
  });

  try {
    // --- B2 step 1: inspect the question file before anything else.
    const questions = await readQuestions(env.DATA_DIR);
    const inspection = inspectQuestions(questions);
    log(`\nquestions.jsonl: ${inspection.rows} questions`);
    log(`fields: ${inspection.fields.map((f) => `${f.field} (${f.rows})`).join(', ')}`);
    log(`types: ${inspection.types.map((t) => `${t.type} ${t.count}`).join(', ')}`);
    for (const [type, example] of Object.entries(inspection.examples)) log(`\nexample ${type}:\n${JSON.stringify(example, null, 2)}`);

    // --- Plan both parts without LLM calls, so the cost is known up front.
    const departureBench = new DepartureBench({ graph, projection, analytics, checker: judge }, log);
    const qaBench = new QaBench({ agent, retrieval, llm, judge, graph }, { graph: APEX_GRAPH, contextBudgetChars: CONTEXT_BUDGET_CHARS, baselineK: BASELINE_K }, log);
    if (args.includes('--rejudge')) {
      const judgeBefore = judge.usage();
      const judgeCalls = () => {
        const now = judge.usage();
        return { made: now.jsonCalls - judgeBefore.jsonCalls, cacheHits: now.jsonCacheHits - judgeBefore.jsonCacheHits };
      };
      // At most two judge calls per stored question: far below the confirmation threshold.
      await rejudge(env.DATA_DIR, out, qaBench, questions, judgeCalls, judgeModelName);
      return;
    }
    let b1Plan: B1Plan | null = null;
    if (runB1) b1Plan = await departureBench.plan(await readDepartures(env.DATA_DIR));
    const sample = runB2 ? samplePerType(questions, (q) => q.question_type, (q) => q.question_id, perType, seed) : [];
    const gold = await qaBench.goldAnswers(sample);

    const b1Calls = b1Plan ? DepartureBench.plannedCalls(b1Plan) : 0;
    const b2Calls = runB2 ? QaBench.plannedCalls(gold) : 0;
    const estimatedMax = b1Calls + b2Calls;
    log(`\nCost estimate (${llmSettings.provider} ${model.model}, upper bound; cached answers cost nothing):`);
    if (runB1) log(`  B1: ${b1Calls} same-system yes/no calls`);
    if (runB2) {
      const judged = [...gold.values()].filter((g) => g.answer.method === 'judge').length;
      log(`  B2: ${sample.length} questions x (agent <= ${MAX_STEPS + 2} + baseline 1 answer + 1 query embedding) + ${judged * 2} judge calls = ${b2Calls}`);
    }
    log(`  total: at most ${estimatedMax} LLM calls`);
    if (args.includes('--dry-run')) return;
    if (estimatedMax > CONFIRM_ABOVE_CALLS && !args.includes('--yes')) {
      if (!(await confirm(`More than ${CONFIRM_ABOVE_CALLS} LLM calls. Continue? [y/N] `))) {
        log('Stopped before any LLM call (pass --yes to skip this question).');
        return;
      }
    }

    // --- Run.
    const before = llm.usage();
    const judgeBefore = judge === llm ? null : judge.usage();
    const b1 = b1Plan ? await departureBench.score(b1Plan) : null;
    const questionResults = runB2 ? await qaBench.run(sample, gold) : [];
    const after = llm.usage();
    const kept = only === null ? { b1: null, b2: null, llmCalls: null } : await previousResults(env.DATA_DIR, out);
    const judgeAfter = judgeBefore ? judge.usage() : null;
    const judgeMade = judgeBefore && judgeAfter ? judgeAfter.jsonCalls - judgeBefore.jsonCalls : 0;
    const judgeHits = judgeBefore && judgeAfter ? judgeAfter.jsonCacheHits - judgeBefore.jsonCacheHits : 0;
    const made = after.jsonCalls - before.jsonCalls + (after.embedCalls - before.embedCalls) + model.calls + judgeMade;
    const cacheHits = after.jsonCacheHits - before.jsonCacheHits + (after.embedCacheHits - before.embedCacheHits) + judgeHits;

    const results: BenchResults = {
      generatedAt: new Date().toISOString(),
      provider: llmSettings.provider,
      model: model.model,
      judgeModel: judgeModelName,
      embedModel,
      // Summed over the runs that produced this file (a partial run adds to the one whose part it keeps).
      llmCalls: {
        estimatedMax: estimatedMax + (kept.llmCalls?.estimatedMax ?? 0),
        made: made + (kept.llmCalls?.made ?? 0),
        cacheHits: cacheHits + (kept.llmCalls?.cacheHits ?? 0),
      },
      inspection: {
        rows: inspection.rows,
        fields: inspection.fields.map((f) => f.field),
        types: inspection.types,
        examples: inspection.examples,
      },
      b1: b1 ?? kept.b1,
      b2: runB2
        ? {
            perType,
            seed,
            contextBudgetChars: CONTEXT_BUDGET_CHARS,
            baselineK: BASELINE_K,
            sampled: inspection.types.map(({ type, count }) => ({
              type,
              available: count,
              sampled: sample.filter((q) => q.question_type === type).length,
            })),
            questions: questionResults,
            ...summarizeQuestions(questionResults),
          }
        : kept.b2,
    };
    const markdown = renderMarkdown(results);
    const paths = await writeResults(env.DATA_DIR, results, markdown, out);
    log(`\n${markdown}`);
    log(`Wrote ${paths.json} and ${paths.md}`);
    if (out === undefined) {
      const published = await publishResults(results, markdown);
      log(`Published to ${published.json}: commit it and the deployed site shows this run.`);
    }
  } finally {
    await tools.close();
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('bench failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
