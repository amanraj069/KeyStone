/**
 * Build the retrieval index (Stage 6): chunk every artifact, embed the chunks
 * (cached), and write (:Chunk)-[:PART_OF]->(:Artifact). Chunk text goes to the TextStore.
 *
 *   pnpm embed --dry-run          chunk counts, memory and cost estimate; no calls, no writes
 *   pnpm embed                    build (rerun = 0 embedding calls, all from cache)
 *   pnpm embed --max-chunks 4     cap per artifact (default 6; lowered automatically if memory is tight)
 *   pnpm embed --graph apex       target graph (default apex)
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';
import { costUsd } from '../src/llm/pricing';
import { embedModelName } from '../src/retrieval/retrieval.module';
import { RetrievalService } from '../src/retrieval/retrieval.service';

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
  const embedModel = embedModelName({ useOpenai: env.USE_OPENAI, openai: env.OPENAI_EMBED_MODEL, gemini: env.GEMINI_EMBED_MODEL });
  const retrieval = new RetrievalService(graph, new SchemaService(graph, env.EMBED_DIM), llm, new LocalTextStore(env.DATA_DIR), {
    embedDim: env.EMBED_DIM,
    memoryWarnMb: env.MEMORY_WARN_MB,
    embedModel,
  });

  try {
    const maxChunks = option('max-chunks');
    const s = await retrieval.indexAll({
      graph: option('graph') ?? 'apex',
      maxChunksPerArtifact: maxChunks ? Number(maxChunks) : undefined,
      dryRun: process.argv.includes('--dry-run'),
    });
    const estimatedTokens = Math.round(s.textChars / 4);
    const estimate = costUsd(embedModel.split('/')[1], { inputTokens: estimatedTokens, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
    console.log(
      `\n${s.artifacts} artifacts -> ${s.chunks} chunks (max ${s.maxChunks} per artifact${s.lowered ? `, lowered from ${s.requestedMaxChunks}` : ''})`,
    );
    console.log(`memory estimate ${s.estimateMb.toFixed(1)} MB for vectors + index; FalkorDB before: ${s.memoryBefore.usedMemoryHuman}`);
    console.log(
      `embedding model ${embedModel}; ~${(estimatedTokens / 1e6).toFixed(2)}M tokens` +
        (estimate === null ? '' : ` (~$${estimate.toFixed(3)} if nothing is cached)`),
    );
    if (!s.dryRun) {
      const cost = costUsd(embedModel.split('/')[1], { inputTokens: s.embedTokens, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
      console.log(
        `embedding calls ${s.embedCalls} (texts from cache ${s.embedCacheHits}); tokens ${s.embedTokens}` +
          (cost === null ? '' : `; cost $${cost.toFixed(4)}`),
      );
      console.log(`FalkorDB after: ${s.memoryAfter?.usedMemoryHuman}; graphs ${JSON.stringify(s.memoryAfter?.graphs)}; ${s.seconds.toFixed(1)} s`);
    }
  } finally {
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('Embedding failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
