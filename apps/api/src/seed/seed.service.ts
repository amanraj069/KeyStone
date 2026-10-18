import { Inject, Injectable, Logger } from '@nestjs/common';
import type { GraphCounts, HealthResponse, SeedStatus } from '@keystone/shared';
import { ExpertiseService } from '../analytics/expertise.service';
import { type ActionsRestoreSummary, ActionsExportService } from '../backup/actions-export.service';
import { BACKUP_WAIT_MS } from '../backup/backup.constants';
import { BackupService } from '../backup/backup.service';
import { countPeople } from '../backup/count-people';
import { GraphLock, type LockHolder } from '../backup/graph-lock';
import { ExtractCacheService } from '../extract/extract-cache.service';
import { MIN_BODY_CHARS } from '../extract/extract.constants';
import { ExtractService } from '../extract/extract.service';
import { APEX_GRAPH, SEED_STAGING_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { SchemaService } from '../graph/schema.service';
import { TEXT_STORE } from '../ingest/ingest.constants';
import { IngestService } from '../ingest/ingest.service';
import type { TextStore } from '../ingest/text-store';
import { LlmService } from '../llm/llm.service';
import { LLM_SETTINGS, type LlmSettings } from '../llm/llm.types';
import { OfflineProvider, offlineSettings } from '../llm/offline.provider';
import { ProjectionService } from '../projection/projection.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { IDLE_STATUS, MAX_REPORTED_MISSING, SEED_SETTINGS, type SeedSettings } from './seed.constants';

/** The seed needs cache entries that are not there. Nothing was sent to an LLM or embedding API. */
export class SeedCacheMissError extends Error {
  override name = 'SeedCacheMissError';

  constructor(readonly missing: string[]) {
    super(
      `${missing.length} cache entries are missing, so the graph cannot be rebuilt from files ` +
        `(no LLM or embedding API call was made): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`,
    );
  }
}

/** Another seed or restore already holds the graph lock. */
export class SeedBusyError extends Error {
  override name = 'SeedBusyError';
}

export interface SeedResult {
  status: 'seeded' | 'skipped';
  /** Why it was skipped. */
  reason?: string;
  people: number;
  ingest?: GraphCounts;
  extractedFromCache?: number;
  linkedSystems?: number;
  staleTargets?: number;
  chunks?: number;
  actions?: ActionsRestoreSummary;
  seconds: number;
}

/**
 * Rebuilds the "apex" graph from files only (AGENTS.md section 3), with zero LLM or
 * embedding API calls:
 *   Stage 4  ingest data/artifacts.jsonl
 *   Stage 5  extraction from DATA_DIR/cache/extract and the LLM cache (links, stale pass)
 *   Stage 6  chunk embeddings from the LLM cache
 *   then     actions from exports/actions-latest.jsonl, expertise refresh, apex_proj
 *
 * Its LlmService is cache-only with a provider that cannot reach any API, and every
 * extraction and embedding entry is checked BEFORE the first write, so a missing entry
 * ends the seed with the full list of missing ids instead of an API call. The new graph
 * is built in apex_seed and only copied over apex at the end, so a failed seed leaves
 * apex as it was.
 *
 * Also owns the API's startup check (ensureGraphOnStartup) and the readiness part of /health.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);
  private readonly llm: LlmService;
  private readonly extract: ExtractService;
  private readonly retrieval: RetrievalService;
  private status: SeedStatus = { ...IDLE_STATUS };

  constructor(
    private readonly graph: GraphService,
    private readonly schema: SchemaService,
    private readonly ingest: IngestService,
    private readonly expertise: ExpertiseService,
    private readonly projection: ProjectionService,
    private readonly actionsExport: ActionsExportService,
    private readonly backup: BackupService,
    private readonly lock: GraphLock,
    @Inject(TEXT_STORE) textStore: TextStore,
    @Inject(LLM_SETTINGS) llmSettings: LlmSettings,
    @Inject(SEED_SETTINGS) settings: SeedSettings,
  ) {
    // Our own LLM layer: cache only, and a provider that refuses every request.
    this.llm = new LlmService(offlineSettings(llmSettings), new OfflineProvider(llmSettings));
    this.extract = new ExtractService(
      graph,
      this.llm,
      textStore,
      { dataDir: settings.dataDir, minBodyChars: MIN_BODY_CHARS, maxCalls: settings.extractMaxCalls, depts: settings.extractDepts },
      new ExtractCacheService(settings.dataDir, settings.s3Bucket),
    );
    this.retrieval = new RetrievalService(graph, schema, this.llm, textStore, {
      embedDim: settings.embedDim,
      memoryWarnMb: settings.memoryWarnMb,
      embedModel: settings.embedModel,
    });
  }

  /** Seeds only if apex is missing or has no people. */
  async seedIfMissing(): Promise<SeedResult> {
    const people = await countPeople(this.graph, APEX_GRAPH);
    if (people > 0) return { status: 'skipped', reason: `${APEX_GRAPH} already has ${people} people`, people, seconds: 0 };
    return this.seed();
  }

  /** Rebuilds apex from files, whatever it holds now (`pnpm seed --force`). */
  async seed(): Promise<SeedResult> {
    const handle = await this.lock.acquire('seed', BACKUP_WAIT_MS);
    if (!handle) throw new SeedBusyError(`A ${(await this.lock.holder())?.op ?? 'graph operation'} is already running`);
    const started = performance.now();
    this.status = { ...IDLE_STATUS, state: 'seeding', startedAt: Date.now() };
    try {
      const result = await this.build();
      result.seconds = Math.round((performance.now() - started) / 100) / 10;
      this.status = { ...this.status, state: 'done', step: null, finishedAt: Date.now() };
      this.logger.log(`Seed complete in ${result.seconds} s: ${JSON.stringify({ ...result, actions: undefined })}`);
      return result;
    } catch (error) {
      const missing = error instanceof SeedCacheMissError ? error.missing : [];
      this.status = {
        ...this.status,
        state: 'failed',
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        missing: missing.slice(0, MAX_REPORTED_MISSING),
        missingCount: missing.length,
      };
      this.logger.error(`Seed failed at "${this.status.step}": ${this.status.error}`);
      if (missing.length > 0) this.logger.error(`Missing cache entries (${missing.length}):\n${missing.join('\n')}`);
      throw error;
    } finally {
      // The cleanup must never skip the release: a lock left behind is renewed by this
      // process forever, blocking every backup and restore and keeping /health on "seeding".
      try {
        if (await this.graph.graphExists(SEED_STAGING_GRAPH)) await this.graph.deleteGraph(SEED_STAGING_GRAPH);
      } catch (error) {
        this.logger.warn(`Could not delete ${SEED_STAGING_GRAPH}: ${String(error)}`);
      } finally {
        await this.lock.release(handle);
      }
    }
  }

  /**
   * Called once by main.ts after the API starts listening. If apex is missing or has
   * no people (SchemaService creates it empty): restore apex_backup if it has people,
   * otherwise seed. Runs in the background; /health says "seeding" meanwhile.
   */
  async ensureGraphOnStartup(): Promise<void> {
    await this.graph.whenConnected();
    await this.schema.whenBootstrapped();
    if ((await countPeople(this.graph, APEX_GRAPH)) > 0) return;

    // A backup holding the lock is fine: restore and seed wait for it (the worker runs
    // its first backup the moment it starts, at the same time as this check).
    const holder = await this.lock.holder();
    if (holder && holder.op !== 'backup') {
      this.logger.warn(`${APEX_GRAPH} is empty, but a ${holder.op} is already running (${holder.owner}); not starting another`);
      return;
    }
    if (await this.backup.hasBackup()) {
      this.logger.warn(`${APEX_GRAPH} is empty; restoring it from the backup graph`);
      this.status = { ...IDLE_STATUS, state: 'restoring', step: 'restore from backup', startedAt: Date.now() };
      try {
        await this.backup.restore({ reapplyActions: true });
        this.status = { ...this.status, state: 'done', step: null, finishedAt: Date.now() };
        return;
      } catch (error) {
        this.logger.error(`Restore from backup failed (${String(error)}); seeding from files instead`);
      }
    }
    this.logger.warn(`${APEX_GRAPH} is empty and there is no usable backup; seeding from files`);
    await this.seedIfMissing().catch(() => undefined); // the failure is in this.status and the log
  }

  /** Who holds the graph lock (seed, restore or backup, in any process), or null. */
  graphOperation(): Promise<LockHolder | null> {
    return this.lock.holder();
  }

  /** The readiness part of GET /health ("seeding" also covers a `pnpm seed` running in another process). */
  async readiness(): Promise<Pick<HealthResponse, 'status' | 'graph' | 'seed'>> {
    const [holder, people] = await Promise.all([
      this.lock.holder().catch(() => null),
      countPeople(this.graph, APEX_GRAPH).catch(() => null),
    ]);
    const busy = this.status.state === 'seeding' || this.status.state === 'restoring' || holder?.op === 'seed' || holder?.op === 'restore';
    const status = busy ? 'seeding' : (people ?? 0) > 0 ? 'up' : 'degraded';
    return { status, graph: { name: APEX_GRAPH, people }, seed: { ...this.status } };
  }

  /** The stages, in the order that reproduces apex exactly (docs/development-notes.md, "Rebuild path"). */
  private async build(): Promise<SeedResult> {
    const graph = SEED_STAGING_GRAPH;

    // A forced rebuild of a live apex: keep its actions (approvals made since the last
    // 6-hourly export exist only there) to merge after actions-latest.jsonl.
    this.step('snapshot the actions of the current apex');
    const live = await this.actionsExport.snapshotActions(APEX_GRAPH);

    this.step('ingest artifacts.jsonl (Stage 4)');
    const ingest = await this.ingest.runFull(graph, async (p) => this.logger.log(`[ingest ${p.percent}%] ${p.message}`));

    this.step('check the extraction and embedding caches');
    const { missing, maxChunks } = await this.missingCacheEntries(graph);
    if (missing.length > 0) throw new SeedCacheMissError(missing);

    this.step('extraction from cache (Stage 5)');
    const extraction = await this.extract.run({ graph, force: true, refresh: false, dryRun: false }, async (p) =>
      this.logger.log(`[extract ${p.percent}%] ${p.message}`),
    );
    this.assertNoFailures(extraction.failures);

    // The stale-page pass picks *core* systems, and only the expertise refresh sets core.
    this.step('expertise refresh, then stale-page links from cache');
    await this.expertise.refresh({ graph });
    const stale = await this.extract.relinkStale(graph, { claimsOnly: false, dryRun: false });
    this.assertNoFailures(stale.failures);

    this.step('embeddings from cache (Stage 6)');
    // The cap the cache check used: indexAll may only lower it, so every chunk it embeds was checked.
    const embedded = await this.retrieval.indexAll({ graph, maxChunksPerArtifact: maxChunks });

    // Approved reassignments move ASSIGNED edges, which expertise reads: restore them before the final refresh.
    this.step('restore actions from the latest export');
    const actions = await this.actionsExport.restoreLatestInto(graph, live);

    this.step('expertise refresh');
    await this.expertise.refresh({ graph });

    const usage = this.llm.usage();
    if (usage.jsonCalls > 0 || usage.embedCalls > 0) {
      throw new Error(`Seed made ${usage.jsonCalls} LLM and ${usage.embedCalls} embedding calls; refusing to publish it`);
    }
    const people = await countPeople(this.graph, graph);
    if (people === 0) throw new Error(`${graph} has no Person nodes after ingest; is artifacts.jsonl empty?`);

    this.step(`copy ${graph} over ${APEX_GRAPH}, rebuild apex_proj`);
    // apex_seed is disposable, so it is renamed over apex: one atomic step, no copy, and
    // apex is never missing (GRAPH.COPY of a 50 MB graph blocks FalkorDB for ~10 s).
    await this.graph.renameGraph(graph, APEX_GRAPH);
    await this.projection.rebuild();

    return {
      status: 'seeded',
      people,
      ingest,
      extractedFromCache: extraction.fromCache,
      linkedSystems: extraction.linkSystems,
      staleTargets: stale.calls,
      chunks: embedded.chunks,
      actions,
      seconds: 0,
    };
  }

  /**
   * Every extraction and chunk embedding the seed will need that is not cached, as
   * "extract:<artifact id>" and "embed:<chunk id>". Only reads caches. The second-pass
   * link prompts depend on the extraction results, so those are checked while running
   * (a miss there becomes "links:<system>" or "stale:<system>" and the seed fails the same way).
   */
  private async missingCacheEntries(graph: string): Promise<{ missing: string[]; maxChunks: number }> {
    const { items } = await this.extract.plan({ graph, refresh: false });
    const extract = items.filter((item) => item.cached === null).map((item) => `extract:${item.id}`);
    const { rows, choice } = await this.retrieval.planChunks(graph);
    const embed = (await this.llm.uncachedEmbeddings(rows.map((row) => row.text))).map((index) => `embed:${rows[index].id}`);
    this.logger.log(`Cache check: ${items.length - extract.length}/${items.length} extractions, ${rows.length - embed.length}/${rows.length} embeddings cached`);
    return { missing: [...extract, ...embed], maxChunks: choice.maxChunks };
  }

  /**
   * Extraction records failures instead of throwing; for the seed any failure is fatal.
   * Second-pass failures are already named "links:<system>" / "stale:<system>"; the
   * others are artifact ids (which may contain ':' themselves).
   */
  private assertNoFailures(failures: { id: string; error: string }[]): void {
    if (failures.length === 0) return;
    const ids = failures.map((f) => (/^(links|stale):/.test(f.id) ? f.id : `extract:${f.id}`));
    this.logger.error(`First failure: ${failures[0].id}: ${failures[0].error}`);
    throw new SeedCacheMissError(ids);
  }

  private step(step: string): void {
    this.status = { ...this.status, step };
    this.logger.log(`Seed: ${step}`);
  }
}
