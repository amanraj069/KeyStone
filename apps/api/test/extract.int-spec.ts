import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractCacheService } from '../src/extract/extract-cache.service';
import { LINKS_SYSTEM_PROMPT } from '../src/extract/extract.prompts';
import { ExtractService } from '../src/extract/extract.service';
import type { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { INGEST_QUEUE } from '../src/ingest/ingest.constants';
import { IngestService } from '../src/ingest/ingest.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { LlmService } from '../src/llm/llm.service';
import type { LlmJsonRequest, LlmProvider } from '../src/llm/llm.types';
import { connectTestGraphService, testGraphName } from './graph-test-utils';
import { MINI_RECORDS } from './ingest-records';

const USAGE = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 };

/**
 * A scripted LLM: every artifact mentions "Titan DB" (an alias of TitanDB) and a
 * low-relevance "noise" system, states one strong and one weak decision, and
 * makes one claim. The second pass says the newest decision supersedes the
 * oldest and that the first page claim restates the oldest decision.
 */
function scriptedProvider(): LlmProvider & { calls: jest.Mock } {
  const calls = jest.fn(async (request: LlmJsonRequest) => {
    if (request.system.startsWith(LINKS_SYSTEM_PROMPT)) {
      const ids = [...request.prompt.matchAll(/^- (D:\S+) \(day/gm)].map((m) => m[1]);
      const pages = [...request.prompt.split('Page claims:')[1].matchAll(/^- (\S+?): /gm)].map((m) => m[1]);
      return {
        text: JSON.stringify({
          supersedes: ids.length >= 2 ? [{ newerId: ids.at(-1), olderId: ids[0] }] : [],
          asserts: pages.length ? [{ pageId: pages[0], decisionId: ids[0] }] : [],
        }),
        usage: USAGE,
      };
    }
    return {
      text: JSON.stringify({
        systems: [
          { name: 'Titan DB', relevance: 0.9 },
          { name: 'noise', relevance: 0.1 },
        ],
        decisions: [
          { summary: 'Adopt TitanDB nightly backups', systems: ['TiDB'], kind: 'adopt', confidence: 0.9 },
          { summary: 'Maybe try something', systems: ['noise'], kind: 'change', confidence: 0.3 },
        ],
        asserts: [{ claim: 'TitanDB is backed up nightly', system: 'TitanDB' }],
      }),
      usage: USAGE,
    };
  });
  return { name: 'openai', model: 'gpt-5-nano', embedModel: 'e', generateJson: calls, embed: jest.fn(), calls };
}

describe('ExtractService on the mini company (scripted LLM)', () => {
  let graph: GraphService;
  let dataDir: string;
  let extract: ExtractService;
  let provider: ReturnType<typeof scriptedProvider>;
  const name = testGraphName();
  const q = <T>(cypher: string) => graph.roQuery<T>(name, cypher);

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'keystone-extract-'));
    await writeFile(join(dataDir, 'artifacts.jsonl'), MINI_RECORDS.map((r) => JSON.stringify(r)).join('\n') + '\n');
    graph = await connectTestGraphService();
    const textStore = new LocalTextStore(dataDir);
    const ingest = new IngestService(graph, new SchemaService(graph, 768), textStore, {
      dataDir,
      redisUrl: 'unused',
      queueName: INGEST_QUEUE,
      workerInline: false,
    });
    await ingest.runFull(name, async () => undefined);

    provider = scriptedProvider();
    const llm = new LlmService(
      {
        provider: 'openai',
        openai: { apiKey: 'unused', model: 'gpt-5-nano', embedModel: 'e', reasoningEffort: 'minimal' },
        gemini: { apiKeys: [], model: 'g', embedModel: 'e' },
        embedDim: 768,
        cacheDir: join(dataDir, 'llm-cache'),
        cacheOnly: false,
        concurrency: 4,
      },
      provider,
    );
    // minBodyChars 0: the mini records have short bodies.
    extract = new ExtractService(graph, llm, textStore, { dataDir, minBodyChars: 0, maxCalls: 100, depts: [] }, new ExtractCacheService(dataDir));
  });

  afterAll(async () => {
    await graph.deleteGraph(name).catch(() => undefined);
    await graph.onModuleDestroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('a dry run plans calls without calling the LLM or writing', async () => {
    const summary = await extract.run({ graph: name, force: false, refresh: false, dryRun: true });
    expect(summary.selected).toBe(6); // 2 meetings, 3 threads, 1 page with a body
    expect(summary.plannedCalls).toBe(6);
    expect(provider.calls).not.toHaveBeenCalled();
    await expect(q('MATCH (s:System) RETURN count(s) AS n')).resolves.toEqual([{ n: 0 }]);
  });

  it('refuses to start above the call budget unless forced', async () => {
    const strict = new ExtractService(graph, (extract as unknown as { llm: LlmService }).llm, new LocalTextStore(dataDir), { dataDir, minBodyChars: 0, maxCalls: 2, depts: [] }, new ExtractCacheService(dataDir));
    await expect(strict.run({ graph: name, force: false, refresh: false, dryRun: true })).rejects.toThrow(/EXTRACT_MAX_CALLS=2/);
  });

  it('writes canonical systems, filtered decisions and their edges', async () => {
    const summary = await extract.run({ graph: name, force: false, refresh: false, dryRun: false });
    expect(summary.failures).toEqual([]);

    // "Titan DB" and "TiDB" both became TitanDB. "noise" only ever appeared below the
    // relevance / confidence thresholds, so it never became a System at all.
    const systems = await q<{ name: string; aliases: string[] }>('MATCH (s:System) RETURN s.name AS name, s.aliases AS aliases ORDER BY name');
    expect(systems).toEqual([{ name: 'TitanDB', aliases: ['TiDB', 'Titan DB'] }]);
    await expect(q("MATCH (a:Artifact)-[m:MENTIONS]->(:System {name: 'TitanDB'}) RETURN count(a) AS n, min(m.weight) AS w")).resolves.toEqual([{ n: 6, w: 0.9 }]);

    // One strong decision per artifact; the weak one (confidence 0.3) is dropped.
    await expect(q('MATCH (d:Decision)-[:DECIDED_IN]->(:Artifact) RETURN count(d) AS n')).resolves.toEqual([{ n: 6 }]);
    await expect(q("MATCH (:Decision)-[:ABOUT]->(:System {name: 'TitanDB'}) RETURN count(*) AS n")).resolves.toEqual([{ n: 6 }]);
  });

  it('the second pass writes SUPERSEDES and ASSERTS, then removes the claims', async () => {
    await expect(q('MATCH (n:Decision)-[r:SUPERSEDES]->(o:Decision) RETURN count(r) AS n, o.status AS status')).resolves.toEqual([{ n: 1, status: 'superseded' }]);
    await expect(q("MATCH (:Page {id: 'CONF-1'})-[:ASSERTS]->(d:Decision) RETURN count(d) AS n")).resolves.toEqual([{ n: 1 }]);
    await expect(q('MATCH (c:Claim) RETURN count(c) AS n')).resolves.toEqual([{ n: 0 }]);
  });

  it('writes data/stats-extraction.md', async () => {
    const stats = await readFile(join(dataDir, 'stats-extraction.md'), 'utf8');
    expect(stats).toContain('## Top 20 systems by mention count');
    expect(stats).toMatch(/\| 1 \| TitanDB \| 6 \|/);
    expect(stats).toContain('## 5 random extracted artifacts');
  });

  it('a rerun makes zero LLM calls and leaves the graph identical', async () => {
    const counts = 'MATCH (n) WHERE n:System OR n:Decision WITH count(n) AS nodes MATCH ()-[r]->() WHERE type(r) IN ["MENTIONS","DECIDED_IN","ABOUT","SUPERSEDES","ASSERTS"] RETURN nodes, count(r) AS edges';
    const before = await q(counts);
    const callsBefore = provider.calls.mock.calls.length;

    const summary = await extract.run({ graph: name, force: false, refresh: false, dryRun: false });

    expect(provider.calls.mock.calls.length).toBe(callsBefore);
    expect(summary.llmCalls + summary.linkCalls).toBe(0);
    expect(summary.fromCache).toBe(6);
    await expect(q(counts)).resolves.toEqual(before);
  });
});
