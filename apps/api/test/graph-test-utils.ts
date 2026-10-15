import { randomBytes } from 'node:crypto';
import { validateEnv } from '../src/config/env.schema';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { GraphService } from '../src/graph/graph.service';
import { loadFixture } from './fixture-loader';

/** Graph names for tests always start with "test_" (see AGENTS.md section 5). */
export const TEST_GRAPH_PREFIX = 'test_';

export function testGraphName(): string {
  return `${TEST_GRAPH_PREFIX}${randomBytes(4).toString('hex')}`;
}

/** A connected GraphService built from the same env vars the API uses. */
export async function connectTestGraphService(): Promise<GraphService> {
  const env = validateEnv(process.env);
  const service = new GraphService(falkorSettingsFromEnv(env));
  await service.connect(3);
  return service;
}

/** Handle returned by useFixtureGraph(); fields are filled in by beforeAll. */
export interface FixtureGraph {
  graph: GraphService;
  name: string;
}

/**
 * Jest helper: in beforeAll, connect and load `fixture` into a fresh
 * test_<random> graph; in afterAll, delete that graph and disconnect.
 * afterAll runs even when tests (or the fixture load) fail, and the
 * globalTeardown sweeps up anything left behind by a crashed run.
 */
export function useFixtureGraph(fixture = 'mini-company'): FixtureGraph {
  const handle = { name: testGraphName() } as FixtureGraph;

  beforeAll(async () => {
    handle.graph = await connectTestGraphService();
    await loadFixture(handle.graph, handle.name, fixture);
  });

  afterAll(async () => {
    if (!handle.graph) return;
    try {
      await handle.graph.deleteGraph(handle.name);
    } catch {
      // the graph may not exist if loading failed early; globalTeardown is the backstop
    } finally {
      await handle.graph.onModuleDestroy();
    }
  });

  return handle;
}
