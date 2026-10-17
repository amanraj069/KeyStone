import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { LocalTextStore } from '../src/ingest/text-store';
import type { LlmService } from '../src/llm/llm.service';
import { CREATE_CHUNKS } from '../src/retrieval/queries/retrieval.queries';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import { connectTestGraphService, testGraphName } from './graph-test-utils';
import { CHUNK_SUMMARY, RETRIEVAL_FIXTURE } from './queries/test.queries';

const DIM = 4;
const MODEL = 'test/fake-embedder';

/** Fake embedder: a question about TitanDB lands right on chunk A; anything else near C. */
function fakeLlm(): LlmService {
  const usage = { embedCalls: 0, embedCacheHits: 0, embedTokens: 0 };
  return {
    embed: jest.fn(async (texts: string[]) => {
      usage.embedCalls++;
      return texts.map((t) => (/titandb/i.test(t) ? [1, 0, 0, 0] : [0, 0, 1, 0.1]));
    }),
    usage: () => ({ ...usage }),
  } as unknown as LlmService;
}

describe('RetrievalService on a 4-dimension test graph', () => {
  let graph: GraphService;
  let dataDir: string;
  let retrieval: RetrievalService;
  const name = testGraphName();

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'keystone-retrieval-'));
    graph = await connectTestGraphService();
    const schema = new SchemaService(graph, DIM);
    await schema.ensureSchema(name); // includes the 4-dim vector index on Chunk.embedding
    await graph.query(name, RETRIEVAL_FIXTURE);

    const store = new LocalTextStore(dataDir);
    // Three hand-made chunks: A points along x, B along y, C along z.
    const chunks = [
      { id: 'A#0', artifactId: 'A', model: MODEL, vector: [1, 0, 0, 0], text: 'TitanDB runbook: restart order.' },
      { id: 'B#0', artifactId: 'B', model: MODEL, vector: [0, 1, 0, 0], text: 'Backups fail at 02:00.' },
      { id: 'C#0', artifactId: 'C', model: MODEL, vector: [0, 0, 1, 0], text: 'Pizza on Friday.' },
    ];
    for (const c of chunks) await store.put('chunks', c.id, c.text);
    await graph.batchWrite(name, CREATE_CHUNKS, chunks.map((c) => ({ id: c.id, artifactId: c.artifactId, model: c.model, vector: c.vector })));

    retrieval = new RetrievalService(graph, schema, fakeLlm(), store, { embedDim: DIM, memoryWarnMb: 3000, embedModel: MODEL });
  });

  afterAll(async () => {
    await graph.deleteGraph(name).catch(() => undefined);
    await graph.onModuleDestroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('hybrid search returns the nearest chunk first, with related artifacts through REFERENCES', async () => {
    const result = await retrieval.search(name, { q: 'How do I restart TitanDB?', k: 3 });
    const top = result.hits[0];

    expect(top).toMatchObject({ chunkId: 'A#0', artifactId: 'A', title: 'TitanDB runbook', authors: ['Ada'] });
    expect(top.text).toBe('TitanDB runbook: restart order.'); // words from the TextStore
    expect(top.similarity).toBeCloseTo(1, 5); // score is a distance: 0 = identical
    expect([...top.related].sort()).toEqual(['B', 'D']); // B is 1 hop, D is 2 hops away
    // Sorted nearest first.
    const distances = result.hits.map((h) => h.distance);
    expect(distances).toEqual([...distances].sort((x, y) => x - y));
  });

  it('applies the "as of day" filter after the vector call', async () => {
    const result = await retrieval.search(name, { q: 'How do I restart TitanDB?', k: 3, asOfDay: 3 });
    expect(result.hits.map((h) => h.artifactId)).not.toContain('A'); // A is day 5
  });

  it('a day range (fromDay..asOfDay) over-fetches, so the nearest hit inside the range still comes back', async () => {
    // The nearest chunk (A, day 5) is outside days 2-3; asking the index for only k = 1 would return nothing.
    const result = await retrieval.search(name, { q: 'How do I restart TitanDB?', k: 1, fromDay: 2, asOfDay: 3 });
    expect(result.hits.map((h) => h.artifactId)).toEqual(['B']);
  });

  it('vector-only search finds the same chunk but adds no graph context', async () => {
    const result = await retrieval.vectorOnlySearch(name, { q: 'How do I restart TitanDB?', k: 3 });
    expect(result.hits[0]).toMatchObject({ chunkId: 'A#0', artifactId: 'A', related: [], authors: [], title: null });
    expect(result.hits[0].text).toBe('TitanDB runbook: restart order.');
  });

  it('refuses to search with a different embedding model than the chunks were made with', async () => {
    const other = new RetrievalService(graph, new SchemaService(graph, DIM), fakeLlm(), new LocalTextStore(dataDir), {
      embedDim: DIM,
      memoryWarnMb: 3000,
      embedModel: 'openai/another-model',
    });
    await expect(other.search(name, { q: 'x', k: 1 })).rejects.toThrow(/re-run `pnpm embed`/);
  });

  it('indexAll chunks artifact bodies, keeps text out of the graph, and rebuilds without duplicates', async () => {
    const store = new LocalTextStore(dataDir);
    for (const id of ['A', 'B', 'C', 'D']) await store.put('artifacts', id, `Body of ${id} about TitanDB. `.repeat(3));
    const summary = await retrieval.indexAll({ graph: name });
    expect(summary).toMatchObject({ artifacts: 4, chunks: 4, maxChunks: 6, lowered: false });
    await expect(graph.roQuery(name, CHUNK_SUMMARY)).resolves.toEqual([{ chunks: 4, artifacts: 4, withText: 0 }]);
    await expect(store.get('chunks', 'A#0')).resolves.toContain('TitanDB runbook'); // title starts chunk 0

    await retrieval.indexAll({ graph: name });
    await expect(graph.roQuery(name, CHUNK_SUMMARY)).resolves.toEqual([{ chunks: 4, artifacts: 4, withText: 0 }]);
  });
});
