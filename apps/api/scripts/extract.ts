/**
 * Run LLM extraction from the command line (same code as POST /extract/run, no queue):
 *
 *   pnpm extract --dry-run            plan + cost estimate, no LLM calls, no graph writes
 *   pnpm extract --limit 50           trial on 50 artifacts spread across types
 *   pnpm extract                      full run (stops if over EXTRACT_MAX_CALLS)
 *   pnpm extract --force              full run even above EXTRACT_MAX_CALLS
 *   pnpm extract --refresh            ignore the extraction cache (costs money)
 *   pnpm extract --graph apex_replay  another graph (default apex)
 *
 * With LLM_CACHE_ONLY=yes any cache miss fails, proving a rerun makes zero LLM calls.
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { ExtractCacheService } from '../src/extract/extract-cache.service';
import { MIN_BODY_CHARS } from '../src/extract/extract.constants';
import { ExtractService } from '../src/extract/extract.service';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { GraphService } from '../src/graph/graph.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';
import { costUsd } from '../src/llm/pricing';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const graph = new GraphService(falkorSettingsFromEnv(env));
  await graph.connect(5);
  const llm = new LlmService(llmSettingsFromEnv(env));
  llm.onModuleInit();
  const extract = new ExtractService(
    graph,
    llm,
    new LocalTextStore(env.DATA_DIR),
    { dataDir: env.DATA_DIR, minBodyChars: MIN_BODY_CHARS, maxCalls: env.EXTRACT_MAX_CALLS, depts: env.EXTRACT_DEPTS },
    new ExtractCacheService(env.DATA_DIR, env.S3_BUCKET),
  );

  const limit = option('limit');
  try {
    const summary = await extract.run(
      {
        graph: option('graph') ?? 'apex',
        force: flag('force'),
        refresh: flag('refresh'),
        dryRun: flag('dry-run'),
        limit: limit ? Number(limit) : undefined,
      },
      async (p) => console.log(`[${String(p.percent).padStart(3)}%] ${p.phase.padEnd(8)} ${p.message}`),
    );
    const estimate = costUsd(summary.model, {
      inputTokens: summary.estimatedInputTokens,
      cachedInputTokens: 0,
      outputTokens: summary.estimatedOutputTokens,
      reasoningTokens: 0,
    });
    console.log(
      `\nselected ${summary.selected} of ${summary.candidates} candidates; planned LLM calls ${summary.plannedCalls}; ` +
        `estimated ~${(summary.estimatedInputTokens / 1e6).toFixed(2)}M in / ${(summary.estimatedOutputTokens / 1e6).toFixed(2)}M out` +
        (estimate === null ? '' : ` (~$${estimate.toFixed(2)} on ${summary.model})`),
    );
    console.log(`vocabulary (${summary.vocabulary.length}): ${summary.vocabulary.slice(0, 60).join(', ')}${summary.vocabulary.length > 60 ? ', ...' : ''}`);
    if (!summary.dryRun) {
      const cost = costUsd(summary.model, summary.tokens);
      console.log(
        `real LLM calls: ${summary.llmCalls} extraction + ${summary.linkCalls} linking; from cache ${summary.fromCache}; ` +
          `failures ${summary.failures.length}; tokens in ${summary.tokens.inputTokens} out ${summary.tokens.outputTokens}` +
          (cost === null ? '' : `; cost $${cost.toFixed(4)}`),
      );
      console.log(`Wrote ${join(env.DATA_DIR, 'stats-extraction.md')}`);
    }
  } finally {
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('Extraction failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
