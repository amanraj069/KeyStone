import { QUERIES, TOOL_QUERIES } from './tool-queries';

describe('tool queries (Show Cypher)', () => {
  it('every tool points at known queries, and every query has Cypher text', () => {
    for (const [tool, ids] of Object.entries(TOOL_QUERIES)) {
      for (const id of ids) expect({ tool, id, known: id in QUERIES }).toEqual({ tool, id, known: true });
    }
    for (const query of Object.values(QUERIES)) expect(query.cypher.length).toBeGreaterThan(10);
  });
});
