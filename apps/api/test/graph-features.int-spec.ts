import type { GraphEdge, GraphNode, GraphPath } from '../src/graph/result-mapper';
import {
  ADA_AUTHORED_T1,
  ADA_NODE,
  COUNT_BATCH_PROBES,
  SUPERSEDES_PATH,
  WRITE_BATCH_PROBES,
} from './queries/test.queries';
import { useFixtureGraph } from './graph-test-utils';

describe('GraphService features on the mini-company fixture', () => {
  const fx = useFixtureGraph();

  it('batchWrite writes 1,200 rows across 3 batches', async () => {
    const rows = Array.from({ length: 1200 }, (_, n) => ({ n, label: `row-${n}` }));
    const result = await fx.graph.batchWrite(fx.name, WRITE_BATCH_PROBES, rows, 500);
    expect(result).toMatchObject({ rows: 1200, batches: 3 });

    const [counts] = await fx.graph.roQuery<{ count: number; total: number }>(fx.name, COUNT_BATCH_PROBES);
    expect(counts).toEqual({ count: 1200, total: (1199 * 1200) / 2 });
  });

  it('batchWrite refuses a query that does not start with UNWIND $rows AS row', async () => {
    await expect(fx.graph.batchWrite(fx.name, 'CREATE (:X)', [{ a: 1 }])).rejects.toThrow(/UNWIND \$rows AS row/);
  });

  it('maps a node to { id, labels, properties }', async () => {
    const [{ p }] = await fx.graph.roQuery<{ p: GraphNode }>(fx.name, ADA_NODE);
    expect(p).toEqual({
      id: expect.any(Number),
      labels: ['Person'],
      properties: { name: 'Ada', dept: 'Engineering_Backend', firstDay: 1, active: true },
    });
  });

  it('maps an edge to { id, type, source, target, properties }', async () => {
    const [{ r }] = await fx.graph.roQuery<{ r: GraphEdge }>(fx.name, ADA_AUTHORED_T1);
    expect(r).toEqual({
      id: expect.any(Number),
      type: 'AUTHORED',
      source: expect.any(Number),
      target: expect.any(Number),
      properties: { day: 3 },
    });
  });

  it('maps a path to { nodes, edges }', async () => {
    const [{ path }] = await fx.graph.roQuery<{ path: GraphPath }>(fx.name, SUPERSEDES_PATH);
    expect(path.nodes.map((n) => n.properties.id)).toEqual(['D-2', 'D-1']);
    expect(path.nodes.every((n) => n.labels.includes('Decision'))).toBe(true);
    expect(path.edges).toHaveLength(1);
    expect(path.edges[0]).toMatchObject({
      type: 'SUPERSEDES',
      source: path.nodes[0].id,
      target: path.nodes[1].id,
      properties: { day: 10 },
    });
  });
});
