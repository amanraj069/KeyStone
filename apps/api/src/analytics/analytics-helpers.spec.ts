import { riskLevel } from './analytics.constants';
import { pathsToGraphView } from './graph-view';

describe('riskLevel', () => {
  it.each([
    [0, 'orphaned'],
    [1, 'critical'],
    [2, 'watch'],
    [3, 'ok'],
    [12, 'ok'],
  ])('%i experts -> %s', (experts, level) => {
    expect(riskLevel(experts)).toBe(level);
  });
});

describe('pathsToGraphView', () => {
  const ada = { id: 1, labels: ['Person'], properties: { name: 'Ada' } };
  const t1 = { id: 2, labels: ['Artifact', 'Ticket'], properties: { id: 'T-1', title: 'TitanDB latency' } };
  const t2 = { id: 3, labels: ['Artifact', 'PR'], properties: { id: 'PR-1', title: 'Fix pool' } };
  const titan = { id: 4, labels: ['System'], properties: { name: 'TitanDB' } };
  const e = (id: number, type: string, source: number, target: number) => ({ id, type, source, target, properties: {} });

  it('merges paths into unique nodes and edges with readable labels and artifact ids', () => {
    const view = pathsToGraphView([
      { nodes: [ada, t1, titan], edges: [e(10, 'AUTHORED', 1, 2), e(11, 'MENTIONS', 2, 4)] },
      { nodes: [ada, t2, titan], edges: [e(12, 'REVIEWED', 1, 3), e(13, 'MENTIONS', 3, 4)] },
    ]);
    expect(view.nodes).toHaveLength(4);
    expect(view.edges).toHaveLength(4);
    expect(view.nodes.find((n) => n.id === 2)).toEqual({ id: 2, label: 'Ticket', name: 'TitanDB latency', artifactId: 'T-1' });
    expect(view.nodes.find((n) => n.id === 1)).toMatchObject({ label: 'Person', name: 'Ada', artifactId: null });
  });
});
