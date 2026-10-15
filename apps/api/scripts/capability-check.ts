/**
 * One-off check that the running FalkorDB supports every feature Keystone needs.
 * Run before Stage 3:  pnpm capability-check
 *
 * It works on a temporary graph `capcheck_<random>`, copies it to `capcheck_copy`,
 * prints PASS/FAIL per feature, deletes both graphs, and exits 1 if anything failed.
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { GraphService } from '../src/graph/graph.service';
import * as Q from './queries/capability-check.queries';

const PEOPLE = ['a', 'b', 'c', 'd', 'e'];
// A triangle a-b-c plus a tail c-d-e: 5 nodes, 5 edges, one connected component.
const EDGES = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'a' },
  { from: 'c', to: 'd' },
  { from: 'd', to: 'e' },
];
// Unit vectors, so the nearest neighbour of a's vector is clearly `a`.
const VECTORS = [
  { name: 'a', embedding: [1, 0, 0, 0] },
  { name: 'b', embedding: [0, 1, 0, 0] },
  { name: 'c', embedding: [0, 0, 1, 0] },
  { name: 'd', embedding: [0, 0, 0, 1] },
  { name: 'e', embedding: [0.7, 0.7, 0, 0] },
];
const COPY_GRAPH = 'capcheck_copy';

type Check = { feature: string; run: () => Promise<string> };
type Scored = { name: string; score: number };

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const graph = new GraphService({ host: env.FALKOR_HOST, port: env.FALKOR_PORT, password: env.FALKOR_PASSWORD });
  await graph.connect(5);

  const name = `capcheck_${randomBytes(4).toString('hex')}`;
  console.log(`\nFalkorDB capability check on ${env.FALKOR_HOST}:${env.FALKOR_PORT}, graph "${name}"\n`);

  // Each check returns a short detail string, or throws to signal FAIL.
  const checks: Check[] = [
    {
      feature: 'Create 5 nodes and 5 edges',
      run: async () => {
        await graph.query(name, Q.CREATE_PEOPLE, { names: PEOPLE });
        await graph.query(name, Q.CREATE_KNOWS_EDGES, { edges: EDGES });
        const [counts] = await graph.roQuery<{ nodes: number; edges: number }>(name, Q.COUNT_NODES_AND_EDGES);
        expect(counts?.nodes === 5 && counts.edges === 5, `got ${JSON.stringify(counts)}`);
        return 'nodes=5 edges=5';
      },
    },
    {
      feature: 'algo.betweenness',
      run: async () => {
        const rows = await graph.roQuery<Scored>(name, Q.BETWEENNESS);
        const top = [...rows].sort((x, y) => y.score - x.score)[0];
        expect(rows.length === 5 && top !== undefined && top.score > 0, `got ${JSON.stringify(rows)}`);
        return `top=${top!.name} (${top!.score})`;
      },
    },
    {
      feature: 'algo.WCC',
      run: async () => {
        const rows = await graph.roQuery<{ name: string; componentId: number }>(name, Q.WCC);
        const components = new Set(rows.map((row) => row.componentId)).size;
        expect(rows.length === 5 && components === 1, `got ${JSON.stringify(rows)}`);
        return 'components=1';
      },
    },
    {
      feature: 'algo.pageRank',
      run: async () => {
        const rows = await graph.roQuery<Scored>(name, Q.PAGE_RANK);
        expect(rows.length === 5 && rows.every((row) => row.score > 0), `got ${JSON.stringify(rows)}`);
        return `scores=${rows.map((row) => `${row.name}:${row.score.toFixed(3)}`).join(' ')}`;
      },
    },
    {
      feature: 'RETURN exp(1)',
      run: async () => {
        const [row] = await graph.roQuery<{ e: number }>(name, Q.EXP_ONE);
        expect(row !== undefined && Math.abs(row.e - Math.E) < 1e-9, `got ${JSON.stringify(row)}`);
        return `e=${row!.e}`;
      },
    },
    {
      feature: 'Vector index (4 dims) + query',
      run: async () => {
        await graph.query(name, Q.CREATE_VECTOR_INDEX);
        await graph.query(name, Q.SET_EMBEDDINGS, { vectors: VECTORS });
        const rows = await graph.roQuery<Scored>(name, Q.VECTOR_NEAREST, { k: 2, query: [1, 0, 0, 0] });
        expect(rows[0]?.name === 'a', `nearest should be a, got ${JSON.stringify(rows)}`);
        return `nearest=${rows.map((row) => row.name).join(',')}`;
      },
    },
    {
      feature: `copyGraph -> ${COPY_GRAPH}`,
      run: async () => {
        await graph.deleteGraph(COPY_GRAPH).catch(() => undefined); // leftover from an aborted run
        await graph.copyGraph(name, COPY_GRAPH);
        const [row] = await graph.roQuery<{ people: number }>(COPY_GRAPH, Q.COUNT_PEOPLE);
        expect(row?.people === 5, `copy has ${JSON.stringify(row)}`);
        return 'copy has 5 people';
      },
    },
    {
      feature: 'deleteGraph (both graphs)',
      run: async () => {
        await graph.deleteGraph(name);
        await graph.deleteGraph(COPY_GRAPH);
        const remaining = await graph.listGraphs();
        expect(!remaining.includes(name) && !remaining.includes(COPY_GRAPH), `still listed: ${remaining.join(',')}`);
        return 'both gone';
      },
    },
  ];

  let failures = 0;
  try {
    for (const check of checks) {
      try {
        const detail = await check.run();
        console.log(`PASS  ${check.feature.padEnd(32)} ${detail}`);
      } catch (error) {
        failures++;
        console.log(`FAIL  ${check.feature.padEnd(32)} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    // Clean up even if a check crashed half way.
    const leftovers = (await graph.listGraphs()).filter((graphName) => graphName === name || graphName === COPY_GRAPH);
    for (const leftover of leftovers) await graph.deleteGraph(leftover);
    await graph.onModuleDestroy();
  }

  console.log(`\n${checks.length - failures}/${checks.length} passed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Tiny assertion helper: throws with `message` when `condition` is false. */
function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((error: unknown) => {
  console.error('Capability check could not run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
