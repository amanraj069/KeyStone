import type { GraphService } from './graph.service';
import { isIndexAlreadyExistsError, SchemaService } from './schema.service';

describe('SchemaService.ensureSchema', () => {
  function serviceWith(query: jest.Mock) {
    return new SchemaService({ query } as unknown as GraphService, 768);
  }

  it('runs all 11 statements on the given graph', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(serviceWith(query).ensureSchema('g')).resolves.toEqual({ created: 11, alreadyExisted: 0 });
    expect(query).toHaveBeenCalledTimes(11);
    expect(query.mock.calls.every(([graph]) => graph === 'g')).toBe(true);
  });

  it('ignores "already indexed" errors', async () => {
    const query = jest.fn().mockRejectedValue(new Error("Attribute 'name' is already indexed"));
    await expect(serviceWith(query).ensureSchema('g')).resolves.toEqual({ created: 0, alreadyExisted: 11 });
  });

  it('rethrows any other error', async () => {
    const query = jest.fn().mockRejectedValue(new Error('Syntax error at offset 3'));
    await expect(serviceWith(query).ensureSchema('g')).rejects.toThrow(/Syntax error/);
  });

  it('recognises only the index-exists message', () => {
    expect(isIndexAlreadyExistsError(new Error("Attribute 'embedding' is already indexed"))).toBe(true);
    expect(isIndexAlreadyExistsError(new Error('FalkorDB is not connected yet'))).toBe(false);
  });
});
