import { Inject, Injectable, Logger } from '@nestjs/common';
import type { GraphCounts, IngestProgress, ReplayRequest } from '@keystone/shared';
import { GraphService } from '../graph/graph.service';
import { SchemaService } from '../graph/schema.service';
import { readArtifacts } from './artifact-record';
import { readCalendar } from './calendar';
import { INGEST_SETTINGS, type IngestSettings, TEXT_STORE } from './ingest.constants';
import { buildPlan, type IngestPlan, type IngestSlice, sliceFor } from './ingest-plan';
import type { ArtifactLabel } from './labels';
import * as Q from './queries/ingest.queries';
import type { TextStore } from './text-store';

/** Receives progress events; the BullMQ worker forwards them to job.updateProgress. */
export type ProgressReporter = (progress: IngestProgress) => Promise<void>;

/** Runs after each replayed day (extraction copy + expertise refresh); its counts join that day's event. */
export type AfterDayHook = (day: number) => Promise<Record<string, number>>;

const MERGE_BY_LABEL: Readonly<Record<ArtifactLabel, string>> = {
  Ticket: Q.MERGE_TICKET_ARTIFACTS,
  Page: Q.MERGE_PAGE_ARTIFACTS,
  Thread: Q.MERGE_THREAD_ARTIFACTS,
  PR: Q.MERGE_PR_ARTIFACTS,
  Email: Q.MERGE_EMAIL_ARTIFACTS,
  Meeting: Q.MERGE_MEETING_ARTIFACTS,
  Alert: Q.MERGE_ALERT_ARTIFACTS,
  Record: Q.MERGE_RECORD_ARTIFACTS,
};

const MERGE_BY_ROLE = {
  AUTHORED: Q.MERGE_AUTHORED,
  REVIEWED: Q.MERGE_REVIEWED,
  ASSIGNED: Q.MERGE_ASSIGNED,
  PARTICIPATED: Q.MERGE_PARTICIPATED,
} as const;

/** Bodies are written to the TextStore this many at a time. */
const TEXT_WRITE_CONCURRENCY = 100;

/**
 * Deterministic ingestion: data/artifacts.jsonl -> FalkorDB, no LLM.
 * - runFull: rebuild a graph with the whole company.
 * - runReplay: rebuild it one simulation day at a time, pausing between days,
 *   so the graph visibly grows (the demo).
 * Both write the same slices with the same MERGE queries.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly schema: SchemaService,
    @Inject(TEXT_STORE) private readonly textStore: TextStore,
    @Inject(INGEST_SETTINGS) private readonly settings: IngestSettings,
  ) {}

  /** Reads artifacts.jsonl and derives the roster, roles and links. */
  async loadPlan(): Promise<IngestPlan> {
    const records = await readArtifacts(this.settings.dataDir);
    const plan = buildPlan(records, await readCalendar(this.settings.dataDir));
    this.logger.log(
      `Plan: ${records.length} artifacts, ${plan.roster.people.length} people, ${plan.roles.length} roles, ` +
        `${plan.references.length} references, ${plan.fixes.length} fixes, ${plan.departures.length} departures, ` +
        `days ${plan.days[0]}..${plan.days.at(-1)}`,
    );
    return plan;
  }

  /** Deletes `graphName` (if it exists) and recreates its indexes. */
  async resetGraph(graphName: string): Promise<void> {
    if ((await this.graph.listGraphs()).includes(graphName)) {
      await this.graph.deleteGraph(graphName);
    }
    await this.schema.ensureSchema(graphName);
  }

  /** Rebuilds `graphName` from scratch with every artifact, dayUnknown ones included. */
  async runFull(graphName: string, report: ProgressReporter, plan?: IngestPlan): Promise<GraphCounts> {
    const send = this.sender('full', graphName, report);
    const company = plan ?? (await this.loadPlan());
    await send('reset', 2, null, {}, `Resetting graph ${graphName}`);
    await this.resetGraph(graphName);

    const added = await this.writeSlice(graphName, sliceFor(company, () => true), (phase, percent, counts) =>
      send(phase, percent, null, counts, `Wrote ${phase}`),
    );
    await this.graph.assertMemoryBudget(`ingest:full:${graphName}`);
    return send('done', 100, null, added, `Full ingest of ${graphName} complete`);
  }

  /**
   * Rebuilds `graphName` day by day from fromDay to toDay. Each day adds that
   * day's artifacts, the people involved, their edges, and links that can now
   * be resolved. Artifacts with an unknown day are not replayed.
   */
  async runReplay(
    graphName: string,
    request: Pick<ReplayRequest, 'fromDay' | 'toDay' | 'delayMs' | 'reset'>,
    report: ProgressReporter,
    plan?: IngestPlan,
    afterDay?: AfterDayHook,
  ): Promise<GraphCounts> {
    const send = this.sender('replay', graphName, report);
    const company = plan ?? (await this.loadPlan());
    if (request.reset) {
      await send('reset', 0, null, {}, `Resetting graph ${graphName}`);
      await this.resetGraph(graphName);
    } else {
      await this.schema.ensureSchema(graphName);
    }

    const days = company.days.filter((day) => day >= request.fromDay && day <= request.toDay);
    let totals: GraphCounts = await this.counts(graphName);
    for (const [index, day] of days.entries()) {
      const added = await this.writeSlice(graphName, sliceFor(company, (record) => record.day === day));
      const extra = afterDay ? await afterDay(day) : {};
      const percent = Math.round(((index + 1) / days.length) * 100);
      const expertise = 'knows' in extra ? `; expertise refreshed (${extra.knows} KNOWS)` : '';
      totals = await send('day', percent, day, { ...added, ...extra }, `Day ${day}: +${added.artifacts} artifacts, ${added.people} people active${expertise}`);
      if (request.delayMs > 0 && index < days.length - 1) await sleep(request.delayMs);
    }
    await this.graph.assertMemoryBudget(`ingest:replay:${graphName}`);
    await send('done', 100, null, {}, `Replay of days ${request.fromDay}..${request.toDay} into ${graphName} complete`);
    return totals;
  }

  /**
   * Writes one slice. Order matters: departments and people, then artifacts,
   * then edges that need both ends, then the per-person day summary.
   * Returns how many rows of each kind were written.
   */
  async writeSlice(
    graphName: string,
    slice: IngestSlice,
    onStep?: (phase: string, percent: number, added: Record<string, number>) => Promise<unknown>,
  ): Promise<Record<string, number>> {
    const added: Record<string, number> = { people: 0, artifacts: 0, roles: 0, references: 0, fixes: 0, departures: 0 };
    const step = async (phase: string, percent: number) => onStep?.(phase, percent, { ...added });

    await this.graph.batchWrite(graphName, Q.MERGE_DEPTS, slice.depts.map((name) => ({ name })));
    await this.graph.batchWrite(graphName, Q.MERGE_PEOPLE, slice.people.map((p) => ({ name: p.name, dept: p.dept })));
    added.people = slice.people.length;
    await step('people', 10);

    for (const [label, rows] of slice.artifactsByLabel) {
      await this.graph.batchWrite(graphName, MERGE_BY_LABEL[label], rows.map((row) => ({ ...row })));
      added.artifacts += rows.length;
    }
    await this.storeBodies(slice.bodies);
    await step('artifacts', 45);

    for (const [rel, query] of Object.entries(MERGE_BY_ROLE)) {
      const rows = slice.roles.filter((role) => role.rel === rel);
      await this.graph.batchWrite(graphName, query, rows.map((r) => ({ ...r })));
      added.roles += rows.length;
    }
    await step('roles', 75);

    await this.graph.batchWrite(graphName, Q.MERGE_REFERENCES, slice.references.map((r) => ({ ...r })));
    await this.graph.batchWrite(graphName, Q.MERGE_FIXES, slice.fixes.map((f) => ({ ...f })));
    added.references = slice.references.length;
    added.fixes = slice.fixes.length;
    await step('links', 90);

    // Departures announced in these artifacts (the person must already exist).
    await this.graph.batchWrite(graphName, Q.MERGE_DEPARTURES, slice.departures.map((d) => ({ ...d })));
    added.departures = slice.departures.length;
    await this.graph.query(graphName, Q.UPDATE_PERSON_ACTIVITY);
    return added;
  }

  /**
   * Rewrites every Person -> Artifact role edge and every announced departure from
   * artifacts.jsonl (after those rules change) without resetting the graph: systems,
   * decisions and chunks stay. Returns the rows written per relationship type.
   */
  async rewriteRoles(graphName: string, plan?: IngestPlan): Promise<Record<string, number>> {
    const company = plan ?? (await this.loadPlan());
    await this.graph.query(graphName, Q.DELETE_ROLE_EDGES);
    await this.graph.query(graphName, Q.DELETE_DEPARTURE_EDGES);
    await this.graph.query(graphName, Q.CLEAR_DEPARTED_DAYS);
    const written: Record<string, number> = {};
    for (const [rel, query] of Object.entries(MERGE_BY_ROLE)) {
      const rows = company.roles.filter((role) => role.rel === rel);
      await this.graph.batchWrite(graphName, query, rows.map((r) => ({ ...r })));
      written[rel] = rows.length;
    }
    await this.graph.batchWrite(graphName, Q.MERGE_DEPARTURES, company.departures.map((d) => ({ ...d })));
    written.DEPARTURE_ANNOUNCED_IN = company.departures.length;
    await this.graph.query(graphName, Q.UPDATE_PERSON_ACTIVITY);
    return written;
  }

  /** {people, artifacts, edges} currently in the graph. */
  async counts(graphName: string): Promise<GraphCounts> {
    const [row] = await this.graph.roQuery<GraphCounts>(graphName, Q.GRAPH_COUNTS);
    return row ?? { people: 0, artifacts: 0, edges: 0 };
  }

  /** Artifact bodies go to the TextStore, never into the graph. */
  private async storeBodies(bodies: IngestSlice['bodies']): Promise<void> {
    for (let start = 0; start < bodies.length; start += TEXT_WRITE_CONCURRENCY) {
      const chunk = bodies.slice(start, start + TEXT_WRITE_CONCURRENCY);
      await Promise.all(chunk.map(({ id, body }) => this.textStore.put('artifacts', id, body)));
    }
  }

  /** Builds and sends one progress event, attaching fresh graph totals. Returns those totals. */
  private sender(kind: IngestProgress['kind'], graphName: string, report: ProgressReporter) {
    return async (
      phase: string,
      percent: number,
      day: number | null,
      added: Record<string, number>,
      message: string,
    ): Promise<GraphCounts> => {
      const totals = await this.counts(graphName).catch(() => ({ people: 0, artifacts: 0, edges: 0 }));
      this.logger.log(`[${kind}:${graphName}] ${message} (people ${totals.people}, artifacts ${totals.artifacts}, edges ${totals.edges})`);
      await report({ kind, graph: graphName, phase, percent, day, added, totals, message });
      return totals;
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
