import { HEALTH_PING } from '../src/graph/queries/graph.queries';
import type { GraphService } from '../src/graph/graph.service';
import { connectTestGraphService, testGraphName } from './graph-test-utils';

// Small fixture: two people who know each other.
const FIXTURE = `
  CREATE (:Person {name: 'Ada'})-[:KNOWS {score: 0.9}]->(:Person {name: 'Bo'})
`;
const COUNT_PEOPLE = 'MATCH (p:Person) RETURN count(p) AS people';

describe('GraphService against a real FalkorDB', () => {
  let graph: GraphService;
  const name = testGraphName();
  const copyName = `${name}_copy`;

  beforeAll(async () => {
    graph = await connectTestGraphService();
    await graph.query(name, FIXTURE);
  });

  afterAll(async () => {
    for (const graphName of [name, copyName]) {
      await graph.deleteGraph(graphName).catch(() => undefined);
    }
    await graph.onModuleDestroy();
  });

  it('HEALTH_PING returns { ok: 1 }', async () => {
    await expect(graph.query(name, HEALTH_PING)).resolves.toEqual([{ ok: 1 }]);
  });

  it('roQuery passes parameters and returns rows', async () => {
    const rows = await graph.roQuery<{ name: string }>(name, 'MATCH (p:Person {name: $name}) RETURN p.name AS name', {
      name: 'Ada',
    });
    expect(rows).toEqual([{ name: 'Ada' }]);
  });

  it('roQuery refuses writes', async () => {
    await expect(graph.roQuery(name, "CREATE (:Person {name: 'Nope'})")).rejects.toThrow();
  });

  it('copyGraph, listGraphs and deleteGraph work together', async () => {
    await graph.copyGraph(name, copyName);
    expect(await graph.listGraphs()).toEqual(expect.arrayContaining([name, copyName]));
    await expect(graph.roQuery(copyName, COUNT_PEOPLE)).resolves.toEqual([{ people: 2 }]);

    await graph.deleteGraph(copyName);
    expect(await graph.listGraphs()).not.toContain(copyName);
  });

  it('memoryReport returns server memory and a per-graph entry', async () => {
    const report = await graph.memoryReport();
    expect(report.usedMemoryHuman).toMatch(/^[\d.]+[BKMG]$/);
    expect(report.graphs.map((g) => g.graph)).toContain(name);
  });
});
