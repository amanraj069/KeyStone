/**
 * Recompute expertise from the command line (same work as the refresh-expertise job):
 * K2 (KNOWS) + K8a (COLLAB) on apex, then rebuild apex_proj, then print the KNOWS
 * score distribution and the risk-level counts at a few minScore values.
 *
 *   pnpm expertise               as of the last day with an artifact
 *   pnpm expertise --as-of 30    as of day 30
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { EXPERT_SHARE_OF_TOP, MIN_EXPERT_SCORE, PROJECTION_GRAPH } from '../src/analytics/analytics.constants';
import { ExpertiseService } from '../src/analytics/expertise.service';
import { CORE_MIN_AUTHORS } from '../src/catalog/catalog.constants';
import { CatalogService } from '../src/catalog/catalog.service';
import { RISK_LEVEL_COUNTS } from '../src/analytics/queries/analytics.queries';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { GraphService } from '../src/graph/graph.service';
import { ProjectionService } from '../src/projection/projection.service';

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const graph = new GraphService(falkorSettingsFromEnv(validateEnv(process.env)));
  await graph.connect(5);
  try {
    const index = process.argv.indexOf('--as-of');
    const asOfDay = index >= 0 ? Number(process.argv[index + 1]) : undefined;
    const env = validateEnv(process.env);
    const catalog = new CatalogService(graph, { coreMinMentions: env.CORE_MIN_MENTIONS, coreMinAuthors: CORE_MIN_AUTHORS });
    const refreshed = await new ExpertiseService(graph, catalog).refresh({ asOfDay });
    const projected = await new ProjectionService(graph).rebuild();

    const d = refreshed.distribution;
    const fmt = (x: number | null) => (x === null ? '-' : x.toFixed(2));
    console.log(`\nKNOWS ${refreshed.knows}, COLLAB ${refreshed.collab} as of day ${refreshed.asOfDay} (${refreshed.ms} ms); ` +
      `${refreshed.coreSystems} core of ${refreshed.systems} systems`);
    console.log(`KNOWS score: min ${fmt(d.min)}, p25 ${fmt(d.p25)}, median ${fmt(d.median)}, p75 ${fmt(d.p75)}, p90 ${fmt(d.p90)}, max ${fmt(d.max)}`);
    console.log(
      `apex_proj: ${projected.people} people, ${projected.systems} systems, ${projected.knows} KNOWS, ` +
        `${projected.collab} COLLAB (pairs with weight >= ${projected.collabMinWeight}, both directions); ` +
        `${projected.targetMb} MB vs apex ${projected.sourceMb} MB (${projected.ms} ms)`,
    );
    // Bus factor on core systems with the expert rule (see MIN_EXPERT_SCORE), and with other floors for comparison.
    for (const minScore of [MIN_EXPERT_SCORE, 1, 2]) {
      const [risk] = await graph.roQuery<Record<string, number>>(PROJECTION_GRAPH, RISK_LEVEL_COUNTS, {
        minScore,
        topShare: EXPERT_SHARE_OF_TOP,
      });
      console.log(`expert = score >= ${minScore} and >= ${EXPERT_SHARE_OF_TOP} x top: ${JSON.stringify(risk)}`);
    }
  } finally {
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('Expertise refresh failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
