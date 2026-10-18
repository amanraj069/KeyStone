import { chunkEmbeddingVectorIndex, schemaStatements } from './schema.queries';

describe('schema queries', () => {
  it('builds the vector index with the configured dimension', () => {
    expect(chunkEmbeddingVectorIndex(768)).toBe(
      "CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {dimension: 768, similarityFunction: 'cosine'}",
    );
  });

  it.each([0, -1, 7.5, 5000, Number.NaN])('refuses to interpolate an invalid dimension (%p)', (dim) => {
    expect(() => chunkEmbeddingVectorIndex(dim)).toThrow(/EMBED_DIM/);
  });

  it('has 11 statements', () => {
    expect(schemaStatements(768)).toHaveLength(11);
  });
});
