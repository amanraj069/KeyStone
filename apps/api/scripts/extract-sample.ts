/**
 * Sample extraction run: measures LLM cost and answer quality on a small,
 * fixed sample of artifacts BEFORE the real extraction stage is built.
 *
 *   pnpm --filter @keystone/api extract-sample -- --size 200 --seed 42
 *   (override the model for one run: OPENAI_MODEL=gpt-5-nano pnpm ...)
 *
 * - Reads only data/artifacts.jsonl (never the answer key).
 * - Never writes to FalkorDB. Writes data/extract-sample/results.jsonl and report.md.
 * - Uses LlmService, so answers are Zod-validated and cached: rerunning the same
 *   sample with the same model costs zero LLM calls.
 * The prompt and schema here are a DRAFT for Stage 5, not the final ones.
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { type ArtifactRecord, readArtifacts } from '../src/ingest/artifact-record';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';
import type { LlmTokenUsage } from '../src/llm/llm.types';

/** Long quotes are trimmed rather than rejected (the sample showed models over-quote). */
const quote = z.string().transform((text) => text.slice(0, 300));

/** Draft extraction schema: what one document says about systems and decisions. */
const Extraction = z.object({
  systems: z
    .array(z.object({ name: z.string().trim().min(1).max(80), evidence: quote }))
    .transform((items) => items.slice(0, 20)),
  decisions: z
    .array(
      z.object({
        summary: z.string().min(1).transform((text) => text.slice(0, 300)),
        status: z.enum(['proposed', 'agreed', 'reversed']),
        evidence: quote,
      }),
    )
    .transform((items) => items.slice(0, 10)),
});
type Extraction = z.infer<typeof Extraction>;

const SYSTEM_PROMPT = [
  'You read one internal document from a sports-technology company and extract facts from it.',
  'Return {"systems": [...], "decisions": [...]}.',
  'systems: named technical systems the document mentions: software services, databases, queues,',
  'infrastructure, cloud services, tools and internal products. Use the name as written in the document.',
  'Do not list people, teams, customers, vendors as companies, or generic words such as "the dashboard".',
  'Each item: {"name": string, "evidence": short quote from the document}.',
  'decisions: decisions the document states or records. Each item: {"summary": one sentence,',
  '"status": "proposed" | "agreed" | "reversed", "evidence": short quote}.',
  'Use only this document. If there are none, return empty lists.',
].join('\n');

/** Long documents are cut so one call stays small (the longest artifact is ~11.7k chars). */
const MAX_BODY_CHARS = 12_000;
const CONCURRENCY = 8;

/** USD per 1M tokens. gpt-5-nano from the price list the user provided; check others on OpenAI's pricing page. */
const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
};

interface Result {
  doc_id: string;
  doc_type: string;
  title: string;
  chars: number;
  ms: number;
  usage: LlmTokenUsage;
  cached: boolean;
  extraction: Extraction | null;
  error: string | null;
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
}

/** Small seeded random generator, so the same seed always picks the same sample. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** At least this many documents of each doc type (if it has that many), so small types are tested too. */
const MIN_PER_TYPE = 5;

/** Safety cap: a sample run never makes more LLM calls than this unless --allow-large is passed. */
const MAX_SAMPLE = 500;

/**
 * Stratified sample of exactly `size` documents: every doc type first gets
 * min(MIN_PER_TYPE, its count) (scaled down if size is small), then the rest is
 * shared out in proportion to how many documents of each type are left.
 */
export function stratifiedSample(records: ArtifactRecord[], size: number, seed: number): ArtifactRecord[] {
  const random = seededRandom(seed);
  const byType = new Map<string, ArtifactRecord[]>();
  for (const record of records) byType.set(record.doc_type, [...(byType.get(record.doc_type) ?? []), record]);
  const target = Math.min(size, records.length);

  // 1. A small floor for every type, never more in total than the target.
  const floor = Math.min(MIN_PER_TYPE, Math.floor(target / byType.size));
  const quotas = new Map([...byType].map(([type, group]) => [type, Math.min(group.length, floor)]));

  // 2. Share the remaining places by how many unsampled documents each type has left.
  let remaining = target - [...quotas.values()].reduce((a, b) => a + b, 0);
  const left = (type: string) => byType.get(type)!.length - quotas.get(type)!;
  const pool = [...byType.keys()].reduce((sum, type) => sum + left(type), 0);
  const shares = [...byType.keys()].map((type) => ({ type, exact: pool ? (remaining * left(type)) / pool : 0 }));
  for (const { type, exact } of shares) {
    const extra = Math.min(left(type), Math.floor(exact));
    quotas.set(type, quotas.get(type)! + extra);
    remaining -= extra;
  }
  // 3. Hand out the last few places one by one (largest fractional share first) where there is room.
  for (const { type } of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (remaining === 0) break;
    if (left(type) > 0) {
      quotas.set(type, quotas.get(type)! + 1);
      remaining--;
    }
  }

  return [...byType.entries()].flatMap(([type, group]) => {
    const shuffled = [...group].sort(() => random() - 0.5);
    return shuffled.slice(0, quotas.get(type));
  });
}

function costUsd(model: string, usage: LlmTokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const freshInput = usage.inputTokens - usage.cachedInputTokens;
  return (freshInput * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1e6;
}

function addUsage(a: LlmTokenUsage, b: LlmTokenUsage): LlmTokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

const ZERO: LlmTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const settings = llmSettingsFromEnv(env);
  const llm = new LlmService(settings);
  llm.onModuleInit();
  const model = settings.provider === 'openai' ? settings.openai.model : settings.gemini.model;

  const size = arg('size', 200);
  const seed = arg('seed', 42);
  const all = await readArtifacts(env.DATA_DIR);
  const sample = stratifiedSample(all, size, seed);
  // Guard rails: never call the LLM unless the sample is exactly what was asked for.
  if (sample.length !== Math.min(size, all.length)) {
    throw new Error(`Sampler picked ${sample.length} documents instead of ${size}; refusing to call the LLM`);
  }
  if (sample.length > MAX_SAMPLE && !process.argv.includes('--allow-large')) {
    throw new Error(`Sample of ${sample.length} exceeds the ${MAX_SAMPLE}-call safety cap; pass --allow-large to run it`);
  }
  console.log(`Sample: ${sample.length} of ${all.length} artifacts (seed ${seed}), model ${model}, ${CONCURRENCY} at a time\n`);

  // Run with a small worker pool; record per-document tokens from the usage counters.
  const results: Result[] = [];
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    while (next < sample.length) {
      const record = sample[next++];
      const t0 = performance.now();
      const result: Result = {
        doc_id: record.doc_id,
        doc_type: record.doc_type,
        title: record.title ?? '',
        chars: (record.body ?? '').length,
        ms: 0,
        usage: ZERO,
        cached: false,
        extraction: null,
        error: null,
      };
      try {
        // Per-call usage comes back with the answer, so it is exact even with concurrent calls.
        const answer = await llm.generateObjectWithUsage(Extraction, {
          task: 'extract-sample-v1',
          system: SYSTEM_PROMPT,
          prompt: `Document type: ${record.doc_type}\nTitle: ${record.title ?? ''}\n\n${(record.body ?? '').slice(0, MAX_BODY_CHARS)}`,
        });
        result.extraction = answer.value;
        result.usage = answer.usage;
        result.cached = answer.cached;
      } catch (error) {
        result.error = error instanceof Error ? error.message.slice(0, 200) : String(error);
      }
      result.ms = Math.round(performance.now() - t0);
      results.push(result);
      if (results.length % 25 === 0) console.log(`  ${results.length}/${sample.length} done`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const seconds = (performance.now() - started) / 1000;

  await writeReport({ env, model, settings, all, sample, results, seconds, usage: llm.usage() });
}

async function writeReport(input: {
  env: ReturnType<typeof validateEnv>;
  model: string;
  settings: ReturnType<typeof llmSettingsFromEnv>;
  all: ArtifactRecord[];
  sample: ArtifactRecord[];
  results: Result[];
  seconds: number;
  usage: ReturnType<LlmService['usage']>;
}): Promise<void> {
  const { env, model, settings, all, results, seconds, usage } = input;
  const ok = results.filter((r) => r.extraction);
  const failed = results.filter((r) => r.error);
  const sampleCost = costUsd(model, usage.tokens);

  // Projection for the whole corpus: average tokens per doc type x number of docs of that type.
  const corpusCount = new Map<string, number>();
  for (const record of all) corpusCount.set(record.doc_type, (corpusCount.get(record.doc_type) ?? 0) + 1);
  const fresh = results.filter((r) => !r.cached && r.extraction);
  let projected: LlmTokenUsage = { ...ZERO };
  for (const [type, count] of corpusCount) {
    const group = fresh.filter((r) => r.doc_type === type);
    if (group.length === 0) continue;
    const sum = group.reduce((acc, r) => addUsage(acc, r.usage), ZERO);
    const scale = count / group.length;
    projected = addUsage(projected, {
      inputTokens: sum.inputTokens * scale,
      cachedInputTokens: sum.cachedInputTokens * scale,
      outputTokens: sum.outputTokens * scale,
      reasoningTokens: sum.reasoningTokens * scale,
    });
  }
  const projectedCost = costUsd(model, projected);

  // What the model found.
  const systemDocs = new Map<string, number>();
  for (const r of ok) {
    for (const name of new Set(r.extraction!.systems.map((s) => s.name.trim()))) {
      systemDocs.set(name, (systemDocs.get(name) ?? 0) + 1);
    }
  }
  const topSystems = [...systemDocs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
  const decisions = ok.flatMap((r) => r.extraction!.decisions.map((d) => ({ ...d, doc: r.doc_id, type: r.doc_type })));

  const types = [...new Set(results.map((r) => r.doc_type))].sort();
  const perType = types.map((type) => {
    const group = ok.filter((r) => r.doc_type === type);
    const avg = (f: (r: Result) => number) => (group.length ? group.reduce((a, r) => a + f(r), 0) / group.length : 0);
    return `| ${type} | ${results.filter((r) => r.doc_type === type).length} | ${avg((r) => r.extraction!.systems.length).toFixed(1)} | ${avg((r) => r.extraction!.decisions.length).toFixed(1)} | ${Math.round(avg((r) => r.usage.inputTokens))} | ${Math.round(avg((r) => r.usage.outputTokens))} |`;
  });

  const latencies = results.filter((r) => !r.cached).map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : 0);
  const usd = (value: number | null) => (value === null ? 'n/a (no price for this model)' : `$${value.toFixed(4)}`);

  const examples = ok.filter((r) => r.extraction!.systems.length + r.extraction!.decisions.length > 0).slice(0, 8);
  const lines = [
    '# Extraction sample report',
    '',
    `Draft prompt \`extract-sample-v1\`; model **${model}**` +
      (settings.provider === 'openai' ? `, reasoning effort **${settings.openai.reasoningEffort}**` : '') +
      `; ${results.length} artifacts (stratified, seeded) of ${all.length}.`,
    '',
    '## Cost',
    '',
    `| | Input | Cached input | Output (incl. reasoning) | Reasoning | Cost |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
    `| This sample (real calls only) | ${usage.tokens.inputTokens} | ${usage.tokens.cachedInputTokens} | ${usage.tokens.outputTokens} | ${usage.tokens.reasoningTokens} | ${usd(sampleCost)} |`,
    `| Projected full pass (${all.length} artifacts) | ${Math.round(projected.inputTokens)} | ${Math.round(projected.cachedInputTokens)} | ${Math.round(projected.outputTokens)} | ${Math.round(projected.reasoningTokens)} | ${usd(projectedCost)} |`,
    '',
    `- LLM calls: **${usage.jsonCalls}** real, **${usage.jsonCacheHits}** from cache (a rerun of this sample costs $0).`,
    `- Failures (invalid JSON or schema): **${failed.length}** of ${results.length}.`,
    `- Wall time ${seconds.toFixed(1)} s at concurrency ${CONCURRENCY}; latency per real call p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms.`,
    '',
    '## Per doc type',
    '',
    '| doc_type | Sampled | Avg systems | Avg decisions | Avg input tokens | Avg output tokens |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...perType,
    '',
    `## Top ${topSystems.length} systems (by number of sampled documents)`,
    '',
    '| System | Documents |',
    '| --- | ---: |',
    ...topSystems.map(([name, n]) => `| ${name} | ${n} |`),
    '',
    `## Decisions: ${decisions.length} found (first 10)`,
    '',
    ...decisions.slice(0, 10).map((d) => `- **${d.status}** (${d.type} ${d.doc}): ${d.summary}`),
    '',
    '## Example extractions',
    '',
    ...examples.flatMap((r) => [
      `### ${r.doc_id} (${r.doc_type}) ${r.title.slice(0, 80)}`,
      `- systems: ${r.extraction!.systems.map((s) => s.name).join(', ') || '(none)'}`,
      ...r.extraction!.decisions.map((d) => `- decision (${d.status}): ${d.summary}`),
      '',
    ]),
    ...(failed.length ? ['## Failures', '', ...failed.map((r) => `- ${r.doc_id}: ${r.error}`), ''] : []),
  ];

  const dir = join(env.DATA_DIR, 'extract-sample');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(join(dir, 'report.md'), lines.join('\n'));
  console.log(`\n${lines.join('\n')}\n\nWrote ${join(dir, 'report.md')} and results.jsonl`);
}

// Only run when executed directly (tests and checks may import stratifiedSample).
if (require.main === module) main().catch((error: unknown) => {
  console.error('Sample run failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
