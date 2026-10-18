import type { ExpertiseService } from '../analytics/expertise.service';
import type { ActionsExportService } from '../backup/actions-export.service';
import type { BackupService } from '../backup/backup.service';
import type { GraphLock } from '../backup/graph-lock';
import type { GraphService } from '../graph/graph.service';
import type { SchemaService } from '../graph/schema.service';
import type { IngestService } from '../ingest/ingest.service';
import type { TextStore } from '../ingest/text-store';
import type { LlmSettings } from '../llm/llm.types';
import type { ProjectionService } from '../projection/projection.service';
import { SeedBusyError, SeedCacheMissError, SeedService } from './seed.service';

const llmSettings: LlmSettings = {
  provider: 'openai',
  openai: { apiKey: undefined, model: 'gpt-5-nano', embedModel: 'text-embedding-3-small', reasoningEffort: 'minimal' },
  gemini: { apiKeys: [], model: 'g', embedModel: 'ge' },
  embedDim: 4,
  cacheDir: '/nonexistent/llm-cache',
  cacheOnly: false,
  concurrency: 1,
};

const LIVE_ACTION = { id: 'act-000000000001', props: { status: 'approved' }, targetType: 'Ticket', target: 'T-1', assignsTo: 'Ada', partOfPlan: null, basedOn: [] };

/** Builds a SeedService whose collaborators are fakes; `calls` records the order of the stages. */
function setup(options: { people?: Record<string, number>; lockFree?: boolean; holderOp?: 'backup'; missingExtract?: string[]; missingEmbed?: number[]; linkFailures?: string[] } = {}) {
  const people: Record<string, number> = { ...(options.people ?? { apex: 0 }) };
  const calls: string[] = [];
  const graph = {
    whenConnected: jest.fn(async () => undefined),
    graphExists: jest.fn(async (name: string) => name in people),
    roQuery: jest.fn(async (name: string) => [{ people: people[name] ?? 0 }]),
    deleteGraph: jest.fn(async (name: string) => void delete people[name]),
    renameGraph: jest.fn(async (src: string, dst: string) => {
      calls.push(`rename ${src}->${dst}`);
      people[dst] = people[src];
      delete people[src];
    }),
  };
  const handle = { holder: { op: 'seed', owner: 'me', startedAt: 0 }, token: 't', renewTimer: setTimeout(() => undefined, 0) };
  const lock = {
    acquire: jest.fn(async () => (options.lockFree === false ? null : handle)),
    release: jest.fn(async () => undefined),
    holder: jest.fn(async () =>
      options.holderOp ? { op: options.holderOp, owner: 'worker', startedAt: 0 } : options.lockFree === false ? { op: 'seed', owner: 'other', startedAt: 0 } : null,
    ),
  };
  const ingest = { runFull: jest.fn(async (name: string) => (calls.push(`ingest ${name}`), (people[name] = 44), { people: 44 })) };
  const expertise = { refresh: jest.fn(async () => void calls.push('expertise')) };
  const projection = { rebuild: jest.fn(async () => void calls.push('projection')) };
  const actionsExport = {
    restoreLatestInto: jest.fn(async () => (calls.push('actions'), { source: 's', actions: 2, reassignments: 1, unresolvedTargets: [] })),
    // The live apex's actions (snapshotActions returns [] for an empty apex).
    snapshotActions: jest.fn(async () => (calls.push('snapshot'), (people.apex ?? 0) > 0 ? [LIVE_ACTION] : [])),
  };
  const backup = { hasBackup: jest.fn(async () => (people.apex_backup ?? 0) > 0), restore: jest.fn(async () => void calls.push('restore')) };
  const schema = { whenBootstrapped: jest.fn(async () => undefined) };

  const seed = new SeedService(
    graph as unknown as GraphService,
    schema as unknown as SchemaService,
    ingest as unknown as IngestService,
    expertise as unknown as ExpertiseService,
    projection as unknown as ProjectionService,
    actionsExport as unknown as ActionsExportService,
    backup as unknown as BackupService,
    lock as unknown as GraphLock,
    {} as TextStore,
    llmSettings,
    { dataDir: '/nonexistent', s3Bucket: undefined, embedDim: 4, memoryWarnMb: 3000, embedModel: 'openai/x', extractDepts: [], extractMaxCalls: 1 },
  );

  // The extraction, retrieval and LLM objects SeedService builds for itself, replaced by fakes.
  const missingExtract = options.missingExtract ?? [];
  const internals = seed as unknown as Record<string, unknown>;
  const extract = {
    plan: jest.fn(async () => ({ candidates: 3, items: ['A-1', 'A-2', 'A-3'].map((id) => ({ id, cached: missingExtract.includes(id) ? null : {} })) })),
    run: jest.fn(async () => (calls.push('extract'), { fromCache: 3, linkSystems: 2, failures: (options.linkFailures ?? []).map((id) => ({ id, error: 'not cached' })) })),
    relinkStale: jest.fn(async () => (calls.push('stale'), { calls: 1, failures: [] })),
  };
  const retrieval = {
    planChunks: jest.fn(async () => ({ rows: [{ id: 'A-1#0', text: 'x' }, { id: 'A-1#1', text: 'y' }], choice: { maxChunks: 2 } })),
    indexAll: jest.fn(async () => (calls.push('embed'), { chunks: 2 })),
  };
  const llm = { uncachedEmbeddings: jest.fn(async () => options.missingEmbed ?? []), usage: () => ({ jsonCalls: 0, embedCalls: 0 }) };
  Object.assign(internals, { extract, retrieval, llm });
  return { seed, graph, lock, ingest, extract, retrieval, backup, actionsExport, calls, people };
}

describe('SeedService', () => {
  it('seedIfMissing does nothing when apex already has people', async () => {
    const { seed, ingest } = setup({ people: { apex: 44 } });
    await expect(seed.seedIfMissing()).resolves.toMatchObject({ status: 'skipped', people: 44 });
    expect(ingest.runFull).not.toHaveBeenCalled();
  });

  it('builds in apex_seed in the rebuild order, restores actions before the last refresh, then swaps it over apex', async () => {
    const { seed, calls, lock, people } = setup();
    await expect(seed.seedIfMissing()).resolves.toMatchObject({ status: 'seeded', people: 44, chunks: 2, actions: { actions: 2 } });
    expect(calls).toEqual(['snapshot', 'ingest apex_seed', 'extract', 'expertise', 'stale', 'embed', 'actions', 'expertise', 'rename apex_seed->apex', 'projection']);
    expect('apex_seed' in people).toBe(false); // renamed into apex
    expect(lock.release).toHaveBeenCalled();
    expect((await seed.readiness()).seed).toMatchObject({ state: 'done' });
  });

  it('a forced seed of a live apex merges its actions after the latest export, and embeds with the checked cap', async () => {
    const { seed, calls, retrieval, actionsExport, lock } = setup({ people: { apex: 44 } });
    await seed.seed();
    expect(calls[0]).toBe('snapshot');
    // Never written over actions-latest.jsonl: merged in after it (approvals only move forward).
    expect(actionsExport.restoreLatestInto).toHaveBeenCalledWith('apex_seed', [LIVE_ACTION]);
    expect(retrieval.indexAll).toHaveBeenCalledWith({ graph: 'apex_seed', maxChunksPerArtifact: 2 });
    expect(lock.acquire).toHaveBeenCalledWith('seed', expect.any(Number)); // waits out a running backup
  });

  it('releases the lock and keeps the original error when deleting the staging graph fails too', async () => {
    const { seed, graph, lock } = setup({ missingExtract: ['A-1'] });
    graph.deleteGraph.mockRejectedValueOnce(new Error('FalkorDB is gone'));
    await expect(seed.seed()).rejects.toBeInstanceOf(SeedCacheMissError);
    expect(graph.deleteGraph).toHaveBeenCalledWith('apex_seed');
    expect(lock.release).toHaveBeenCalled();
  });

  it('lists every missing extraction and embedding before any extraction runs, and leaves apex alone', async () => {
    const { seed, extract, graph, lock, people } = setup({ missingExtract: ['A-2'], missingEmbed: [1] });
    const error = await seed.seed().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeedCacheMissError);
    expect((error as SeedCacheMissError).missing).toEqual(['extract:A-2', 'embed:A-1#1']);
    expect(extract.run).not.toHaveBeenCalled();
    expect(graph.renameGraph).not.toHaveBeenCalled();
    expect('apex_seed' in people).toBe(false);
    expect(lock.release).toHaveBeenCalled();
    expect((await seed.readiness()).seed).toMatchObject({ state: 'failed', missing: ['extract:A-2', 'embed:A-1#1'], missingCount: 2 });
  });

  it('fails the same way when a second-pass link answer is not cached', async () => {
    const { seed, graph } = setup({ linkFailures: ['links:TitanDB', 'slack:C1/2'] });
    const error = (await seed.seed().catch((e: unknown) => e)) as SeedCacheMissError;
    expect(error.missing).toEqual(['links:TitanDB', 'extract:slack:C1/2']);
    expect(graph.renameGraph).not.toHaveBeenCalled();
  });

  it('refuses to start while another seed or restore holds the lock', async () => {
    const { seed, ingest } = setup({ lockFree: false });
    await expect(seed.seed()).rejects.toBeInstanceOf(SeedBusyError);
    expect(ingest.runFull).not.toHaveBeenCalled();
  });

  it('readiness: "up" with people, "degraded" when empty, "seeding" while another process seeds', async () => {
    expect((await setup({ people: { apex: 44 } }).seed.readiness())).toMatchObject({ status: 'up', graph: { name: 'apex', people: 44 } });
    expect((await setup({ people: { apex: 0 } }).seed.readiness()).status).toBe('degraded');
    expect((await setup({ people: { apex: 0 }, lockFree: false }).seed.readiness()).status).toBe('seeding');
  });

  it('on startup: nothing if apex has people, restore if a backup exists, otherwise seed', async () => {
    const full = setup({ people: { apex: 44 } });
    await full.seed.ensureGraphOnStartup();
    expect(full.calls).toEqual([]);

    const withBackup = setup({ people: { apex: 0, apex_backup: 40 } });
    await withBackup.seed.ensureGraphOnStartup();
    expect(withBackup.calls).toEqual(['restore']);

    const nothing = setup({ people: { apex: 0 } });
    await nothing.seed.ensureGraphOnStartup();
    expect(nothing.calls).toContain('ingest apex_seed');
  });

  it('on startup, the worker\'s first backup holding the lock does not stop the restore (it waits for the lock)', async () => {
    const racing = setup({ people: { apex: 0, apex_backup: 40 }, holderOp: 'backup' });
    await racing.seed.ensureGraphOnStartup();
    expect(racing.calls).toEqual(['restore']);
  });
});
