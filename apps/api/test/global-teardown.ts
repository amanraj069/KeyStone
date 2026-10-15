// Runs once after the whole integration suite: deletes every leftover test_*
// graph (e.g. from a run that crashed before its afterAll). Jest does not apply
// setupFiles here, so the env is loaded explicitly.
import './load-env';
import { connectTestGraphService, TEST_GRAPH_PREFIX } from './graph-test-utils';

export default async function globalTeardown(): Promise<void> {
  const graph = await connectTestGraphService();
  try {
    const leftovers = (await graph.listGraphs()).filter((name) => name.startsWith(TEST_GRAPH_PREFIX));
    for (const name of leftovers) {
      await graph.deleteGraph(name);
    }
    if (leftovers.length > 0) console.log(`globalTeardown: deleted ${leftovers.length} leftover test graphs`);
  } finally {
    await graph.onModuleDestroy();
  }
}
