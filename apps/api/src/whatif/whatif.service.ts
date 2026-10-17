import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { EXPERT_SHARE_OF_TOP, MIN_EXPERT_SCORE } from '../analytics/analytics.constants';
import { type Bridge, type BusFactorRow, AnalyticsService, type DepartureImpact } from '../analytics/analytics.service';
import { PERSON_EXISTS } from '../analytics/queries/analytics.queries';
import { GraphService } from '../graph/graph.service';
import { ProjectionService } from '../projection/projection.service';
import * as Q from './queries/whatif.queries';
import { KeyedLock, Semaphore } from './semaphore';
import {
  type BridgeShift,
  bridgeShift,
  diffBusFactor,
  type Island,
  newIslands,
  type SimulationGraph,
  simulationGraph,
  type SystemChange,
} from './whatif-diff';
import {
  CANDIDATES_TTL_MS,
  MAX_SUBGRAPH_SYSTEMS,
  SCRATCH_MAX_AGE_MS,
  SWEEP_INTERVAL_MS,
  WHATIF_SETTINGS,
  type WhatIfSettings,
} from './whatif.constants';

export interface DepartureSimulation {
  person: string;
  dept: string | null;
  systemsNewlyOrphaned: SystemChange[];
  systemsNewlyCritical: SystemChange[];
  islandsCreated: Island[];
  bridgeShift: BridgeShift[];
  /** Open tickets the leaver owns, with suggested owners; `evidence` is the ticket id. */
  orphanedTickets: (DepartureImpact['openTickets'][number] & { evidence: string[] })[];
  /** Pages only the leaver has written or reviewed; `evidence` is the page id. */
  soleAuthoredPages: (DepartureImpact['unsharedPages'][number] & { evidence: string[] })[];
  /** Milliseconds per step: validate, ensureProjection, copy, before, removePerson, after, departureImpact, cleanup, total. */
  timingsMs: Record<string, number>;
  scratchGraph: string;
  scratchGraphMemoryMb: number | null;
  graph: SimulationGraph;
}

export interface DepartureCandidate {
  person: string;
  dept: string | null;
  /** Core systems this person is the only expert on. */
  orphaned: number;
  systems: string[];
  evidence: string[];
}

/**
 * "What if this person leaves?" Never touches the live graph: it copies the small
 * projection (apex_proj: Person, System, KNOWS, COLLAB) into a scratch graph with
 * GRAPH.COPY, deletes the person there, reruns bus factor (K4), bridges (K8b) and
 * knowledge islands (K9) on both, and diffs. Departure impact (K5-K7) reads the
 * live graph, which those queries only parameterise by person. The scratch graph is
 * always deleted (finally), and sweepers remove anything a crash left behind.
 */
@Injectable()
export class WhatIfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatIfService.name);
  private readonly semaphore: Semaphore;
  private readonly perPerson = new KeyedLock<DepartureSimulation>();
  /** Scratch graphs of simulations in progress: the sweepers never touch these. */
  private readonly inUse = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private candidates: { at: number; value: DepartureCandidate[] } | null = null;
  /** A projection rebuild in progress: concurrent simulations wait for it instead of starting another. */
  private rebuilding: Promise<unknown> | null = null;

  constructor(
    private readonly graph: GraphService,
    private readonly analytics: AnalyticsService,
    private readonly projection: ProjectionService,
    @Inject(WHATIF_SETTINGS) private readonly settings: WhatIfSettings,
  ) {
    this.semaphore = new Semaphore(settings.maxConcurrent);
  }

  /** At most maxConcurrent simulations at once; a second request for the same person shares the first. */
  simulateDeparture(person: string): Promise<DepartureSimulation> {
    return this.perPerson.run(person, () => this.semaphore.run(() => this.simulate(person)));
  }

  /** The 10 people whose departure would orphan the most core systems (K5 for everyone), cached 60 s. */
  async departureCandidates(): Promise<DepartureCandidate[]> {
    if (this.candidates && Date.now() - this.candidates.at < CANDIDATES_TTL_MS) return this.candidates.value;
    const value = await this.graph.roQuery<DepartureCandidate>(this.settings.sourceGraph, Q.DEPARTURE_CANDIDATES, {
      minScore: MIN_EXPERT_SCORE,
      topShare: EXPERT_SHARE_OF_TOP,
    });
    this.candidates = { at: Date.now(), value };
    return value;
  }

  /**
   * Deletes leftover scratch graphs: not in use here, and older than SCRATCH_MAX_AGE_MS
   * (or with no readable creation time), so a copy another process is still using
   * survives. Returns their names.
   */
  async sweep(now = Date.now()): Promise<string[]> {
    const { scratchPrefix } = this.settings;
    const leftovers = (await this.graph.listGraphs()).filter((g) => {
      if (!g.startsWith(scratchPrefix) || this.inUse.has(g)) return false;
      const created = scratchCreatedAt(g.slice(scratchPrefix.length));
      return created === null || now - created > SCRATCH_MAX_AGE_MS;
    });
    for (const name of leftovers) await this.graph.deleteGraph(name);
    if (leftovers.length > 0) this.logger.warn(`Deleted ${leftovers.length} leftover what-if graph(s): ${leftovers.join(', ')}`);
    return leftovers;
  }

  onModuleInit(): void {
    // Startup sweep once FalkorDB is reachable, then every hour. Neither blocks startup.
    void this.graph
      .whenConnected()
      .then(() => this.sweep())
      .catch((error: unknown) => this.logger.warn(`Startup sweep failed: ${String(error)}`));
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((error: unknown) => this.logger.warn(`Hourly sweep failed: ${String(error)}`));
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private async simulate(person: string): Promise<DepartureSimulation> {
    const { sourceGraph, projectionGraph, scratchPrefix } = this.settings;
    const timingsMs: Record<string, number> = {};
    const started = performance.now();
    const time = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      try {
        return await work();
      } finally {
        timingsMs[step] = Math.round(performance.now() - t0);
      }
    };

    // a. The person must exist and still be active in the live graph; the projection must be current.
    const [who] = await time('validate', () =>
      this.graph.roQuery<{ name: string; dept: string | null; active: boolean }>(sourceGraph, PERSON_EXISTS, { person }),
    );
    if (!who) throw new NotFoundException(`No person named "${person}"`);
    if (!who.active) throw new ConflictException(`${person} is not active (already departed)`);
    await time('ensureProjection', () => this.ensureFreshProjection());

    // b. Scratch copy of the projection (never of the live graph).
    const scratch = `${scratchPrefix}${scratchId()}`;
    this.inUse.add(scratch);
    try {
      await time('copy', () => this.graph.copyGraph(projectionGraph, scratch));
      const scratchGraphMemoryMb = await this.graph.graphMemoryMb(scratch);

      // c. Before (projection) -> remove the person (scratch) -> after (scratch); impact from the live graph.
      const [busBefore, bridgesBefore, islandsBefore] = await time('before', () => this.measure(projectionGraph));
      await time('removePerson', () => this.graph.query(scratch, Q.REMOVE_PERSON, { person }));
      const [busAfter, bridgesAfter, islandsAfter] = await time('after', () => this.measure(scratch));
      const impact = await time('departureImpact', () =>
        this.analytics.departureImpact(person, MIN_EXPERT_SCORE, sourceGraph, EXPERT_SHARE_OF_TOP),
      );

      // d. The diff, every item with the artifact ids behind it.
      const { newlyOrphaned, newlyCritical } = diffBusFactor(busBefore, busAfter, person);
      const islandNames = newIslands(islandsBefore, islandsAfter);
      const leaverKnows =
        islandNames.length === 0
          ? []
          : await this.graph.roQuery<{ system: string; score: number; evidence: string[] }>(projectionGraph, Q.LEAVER_KNOWS, {
              person,
              systems: islandNames,
            });
      const islandsCreated = islandNames.map((system) => ({
        system,
        evidence: leaverKnows.find((k) => k.system === system)?.evidence ?? [],
      }));

      return {
        person,
        dept: who.dept,
        systemsNewlyOrphaned: newlyOrphaned,
        systemsNewlyCritical: newlyCritical,
        islandsCreated,
        bridgeShift: bridgeShift(bridgesBefore, bridgesAfter),
        orphanedTickets: impact.openTickets.map((t) => ({ ...t, evidence: [t.ticket] })),
        soleAuthoredPages: impact.unsharedPages.map((p) => ({ ...p, evidence: [p.page] })),
        timingsMs,
        scratchGraph: scratch,
        scratchGraphMemoryMb,
        graph: simulationGraph({
          person,
          impact,
          busFactorBefore: busBefore,
          newlyOrphaned,
          newlyCritical,
          islands: islandsCreated,
          leaverScores: new Map(leaverKnows.map((k) => [k.system, k.score])),
          maxSystems: MAX_SUBGRAPH_SYSTEMS,
        }),
      };
    } finally {
      // ALWAYS delete the copy, also when a step above threw. A failed delete is left to the sweepers.
      await time('cleanup', () =>
        this.graph.deleteGraph(scratch).catch((error: unknown) => this.logger.error(`Could not delete ${scratch}: ${String(error)}`)),
      );
      this.inUse.delete(scratch);
      timingsMs.total = Math.round(performance.now() - started);
    }
  }

  /**
   * Rebuilds apex_proj when it is older than the last expertise refresh. One rebuild
   * at a time: a rebuild deletes and rewrites the graph, and copying it halfway would
   * simulate on a partial projection. (The projection's stamp is written last, so a
   * half-built projection always looks stale and its readers wait here.)
   */
  private async ensureFreshProjection(): Promise<void> {
    const { sourceGraph, projectionGraph } = this.settings;
    while (this.rebuilding) await this.rebuilding.catch(() => undefined);
    if (await this.projection.isFresh(projectionGraph, sourceGraph)) return;
    if (!this.rebuilding) {
      this.rebuilding = this.projection.rebuild(projectionGraph, { sourceGraph }).finally(() => (this.rebuilding = null));
    }
    await this.rebuilding;
  }

  /** Bus factor (K4), bridges (K8b, evidence from the live graph) and knowledge islands (K9) on one graph. */
  private measure(graphName: string): Promise<[BusFactorRow[], Bridge[], string[]]> {
    return Promise.all([
      this.analytics.busFactor(MIN_EXPERT_SCORE, graphName, EXPERT_SHARE_OF_TOP),
      this.analytics.bridges(graphName, this.settings.sourceGraph),
      this.graph.roQuery<{ orphanedSystem: string }>(graphName, Q.K9_KNOWLEDGE_ISLANDS).then((rows) => rows.map((r) => r.orphanedSystem)),
    ]);
  }
}

/** Scratch id "<creation time in base 36>_<random>", e.g. "mgx1k2p0_8c172e81". */
export function scratchId(now = Date.now()): string {
  return `${now.toString(36)}_${randomBytes(4).toString('hex')}`;
}

/** The creation time (epoch ms) in a scratch id, or null when it has none. */
export function scratchCreatedAt(id: string): number | null {
  const match = /^([0-9a-z]+)_[0-9a-f]+$/.exec(id);
  if (!match) return null;
  const time = parseInt(match[1], 36);
  return Number.isSafeInteger(time) ? time : null;
}
