import { mapRows, toPlain } from './result-mapper';

// Raw shapes exactly as the falkordb client returned them from the local container.
const rawNode = { id: 0, labels: ['Person'], properties: { name: 'Ada', tags: ['x'] } };
const rawEdge = { id: 3, sourceId: 0, destinationId: 1, properties: { score: 0.5 }, relationshipType: 'KNOWS' };
const rawBo = { id: 1, labels: ['Person'], properties: { name: 'Bo' } };

describe('result mapper', () => {
  it('maps a node to { id, labels, properties }', () => {
    expect(toPlain(rawNode)).toEqual({ id: 0, labels: ['Person'], properties: { name: 'Ada', tags: ['x'] } });
  });

  it('maps an edge to { id, type, source, target, properties }', () => {
    expect(toPlain(rawEdge)).toEqual({ id: 3, type: 'KNOWS', source: 0, target: 1, properties: { score: 0.5 } });
  });

  it('maps a path to { nodes, edges } with converted members', () => {
    expect(toPlain({ nodes: [rawNode, rawBo], edges: [rawEdge] })).toEqual({
      nodes: [toPlain(rawNode), toPlain(rawBo)],
      edges: [{ id: 3, type: 'KNOWS', source: 0, target: 1, properties: { score: 0.5 } }],
    });
  });

  it('walks into lists and maps and leaves scalars alone', () => {
    const [row] = mapRows<{ list: unknown[]; map: Record<string, unknown>; n: null; f: number }>([
      { list: [rawEdge], map: { who: rawNode, x: 1 }, n: null, f: 1.5 },
    ]);
    expect(row.list[0]).toMatchObject({ type: 'KNOWS' });
    expect(row.map).toEqual({ who: toPlain(rawNode), x: 1 });
    expect(row.n).toBeNull();
    expect(row.f).toBe(1.5);
  });

  it('does not mistake an ordinary map for a node', () => {
    const map = { id: 1, labels: ['x'], properties: {}, extra: true };
    expect(toPlain(map)).toEqual(map);
  });
});
