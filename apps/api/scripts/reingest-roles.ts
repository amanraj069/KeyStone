/**
 * Rewrites every Person -> Artifact role edge (AUTHORED, REVIEWED, ASSIGNED,
 * PARTICIPATED) from data/artifacts.jsonl, without resetting the graph, then
 * refreshes expertise (KNOWS, COLLAB) and apex_proj. Use after the role rules change.
 *
 *   pnpm reingest-roles [--graph apex]
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { ExpertiseService } from '../src/analytics/expertise.service';
import { CORE_MIN_AUTHORS } from '../src/catalog/catalog.constants';
import { CatalogService } from '../src/catalog/catalog.service';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { INGEST_QUEUE } from '../src/ingest/ingest.constants';
import { IngestService } from '../src/ingest/ingest.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { projectionGraphFor } from '../src/analytics/analytics.constants';
import { ProjectionService } from '../src/projection/projection.service';

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const graph = new GraphService(falkorSettingsFromEnv(env));
  await graph.connect(5);
  const index = process.argv.indexOf('--graph');
  const graphName = index >= 0 ? process.argv[index + 1] : 'apex';
  try {
    const ingest = new IngestService(graph, new SchemaService(graph, env.EMBED_DIM), new LocalTextStore(env.DATA_DIR), {
      dataDir: env.DATA_DIR,
      redisUrl: env.REDIS_URL,
      queueName: INGEST_QUEUE,
      workerInline: false,
    });
    const written = await ingest.rewriteRoles(graphName);
    console.log(`\nRole edges rewritten on ${graphName}:`, written);
    const catalog = new CatalogService(graph, { coreMinMentions: env.CORE_MIN_MENTIONS, coreMinAuthors: CORE_MIN_AUTHORS });
    const refreshed = await new ExpertiseService(graph, catalog).refresh({ graph: graphName });
    const projected = await new ProjectionService(graph).rebuild(projectionGraphFor(graphName), { sourceGraph: graphName });
    console.log(
      `Expertise: ${refreshed.knows} KNOWS, ${refreshed.collab} COLLAB, ${refreshed.coreSystems} core systems; ` +
        `${projected.targetGraph}: ${projected.people} people, ${projected.systems} systems, ${projected.knows} KNOWS, ${projected.collab} COLLAB`,
    );
  } finally {
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('reingest-roles failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
