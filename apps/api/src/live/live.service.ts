import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import type { BusFactorRow, LiveArtifact, LiveEvent, LivePost, LiveResult, LiveStep, StaleDoc } from '@keystone/shared';
import { randomBytes } from 'node:crypto';
import { WATCHER } from '../actions/actions.constants';
import { ActionsService } from '../actions/actions.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExpertiseService } from '../analytics/expertise.service';
import { GraphLock } from '../backup/graph-lock';
import { ExtractService } from '../extract/extract.service';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import type { ArtifactRecord } from '../ingest/artifact-record';
import { IngestService } from '../ingest/ingest.service';
import { UPDATE_PERSON_ACTIVITY } from '../ingest/queries/ingest.queries';
import { ProjectionService } from '../projection/projection.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import * as Q from './queries/live.queries';

/** Before and after one live document: risk per core system, stale pages, who is inactive. */
interface Snapshot {
  risk: Map<string, BusFactorRow>;
  stale: StaleDoc[];
  inactive: Set<string>;
}

const DEFAULT_CHANNEL = 'engineering';

/**
 * "Keeping knowledge current": a document posted now goes through the same steps
 * as the corpus (ingest rules, LLM extraction with its cache, embeddings), then
 * expertise and the projection are refreshed and Keystone reports what changed:
 * decisions replaced, pages now stale, systems whose risk moved, people now gone.
 * One at a time, never during a seed or restore. Live documents are marked and can
 * all be removed with reset(); the seed does not re-ingest them.
 */
@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private running = false;

  constructor(
    private readonly graph: GraphService,
    private readonly ingest: IngestService,
    private readonly extract: ExtractService,
    private readonly retrieval: RetrievalService,
    private readonly expertise: ExpertiseService,
    private readonly projection: ProjectionService,
    private readonly analytics: AnalyticsService,
    private readonly lock: GraphLock,
    private readonly actions: ActionsService,
  ) {}

  /** Posts one document; `emit` gets a start and a done event per step. Throws on bad input or when busy. */
  async post(post: LivePost, emit: (event: LiveEvent) => void = () => undefined): Promise<LiveResult> {
    if (this.running) throw new ConflictException('Another live document is being processed; try again in a few seconds');
    const holder = await this.lock.holder();
    if (holder) throw new ConflictException(`A ${holder.op} is running; try again when it finishes`);
    if (!(await this.ingest.isEmployee(post.author))) {
      const names = (await this.analytics.listPeople(true)).map((p) => p.name);
      throw new BadRequestException(`"${post.author}" is not an employee. Pick one of: ${names.slice(0, 12).join(', ')}…`);
    }
    this.running = true;
    const started = Date.now();
    try {
      const step = async <T>(name: LiveStep, work: () => Promise<T>, detail?: (value: T) => string): Promise<T> => {
        emit({ type: 'step', step: name, status: 'start' });
        const t0 = Date.now();
        const value = await work();
        emit({ type: 'step', step: name, status: 'done', ms: Date.now() - t0, ...(detail ? { detail: detail(value) } : {}) });
        return value;
      };

      const before = await this.snapshot();
      const day = await this.expertise.lastDay(APEX_GRAPH);
      const record = toRecord(post, liveId(new Date()), day);
      const title = record.title ?? record.doc_id;

      await step('ingest', async () => {
        const added = await this.ingest.ingestOne(APEX_GRAPH, record);
        await this.graph.query(APEX_GRAPH, Q.MARK_LIVE, { id: record.doc_id, at: Date.now() });
        return added;
      }, (added) => `${added.roles ?? 0} role edges, ${added.departures ?? 0} departure announcements`);
      const extracted = await step('extract', () => this.extract.extractOne(APEX_GRAPH, record.doc_id), (x) =>
        `${x.systems.length} systems, ${x.decisions.length} decisions, ${x.supersedes} replaced`,
      );
      const embedded = await step('embed', () => this.retrieval.indexOne(APEX_GRAPH, record.doc_id, title), (x) => `${x.chunks} chunks`);
      await step('refresh', async () => {
        await this.expertise.refresh({ graph: APEX_GRAPH, asOfDay: day });
        await this.projection.rebuild();
      });
      const after = await step('diff', () => this.snapshot());
      const newlyStale = after.stale.filter((doc) => !before.stale.some((old) => staleKey(old) === staleKey(doc)));
      const changedRisk = riskChanges(before.risk, after.risk);
      const newlyInactive = [...after.inactive].filter((name) => !before.inactive.has(name)).sort();

      // The risk watcher proposes the follow-up work by itself; a person approves it on Audit.
      const proposals = await step(
        'act',
        () => this.actions.reactToChange({ sourceId: record.doc_id, author: post.author, newlyStale, riskChanges: changedRisk, newlyInactive }),
        (made) => `${made.filter((p) => p.created).length} new proposals`,
      );

      const result: LiveResult = {
        id: record.doc_id,
        title,
        day: record.day,
        systems: extracted.systems,
        decisions: extracted.decisions,
        supersedes: extracted.supersedes,
        newlyStale,
        riskChanges: changedRisk,
        newlyInactive,
        proposals,
        llmCalls: extracted.llmCalls,
        embedCalls: embedded.embedCalls,
        ms: Date.now() - started,
      };
      this.logger.log(`Live document ${result.id}: ${JSON.stringify({ ...result, newlyStale: result.newlyStale.length })}`);
      return result;
    } finally {
      this.running = false;
    }
  }

  /** The live documents posted so far. */
  async list(): Promise<LiveArtifact[]> {
    return this.graph.roQuery<LiveArtifact>(APEX_GRAPH, Q.LIVE_ARTIFACTS);
  }

  /**
   * Removes every live document and what it added, including the watcher's proposals
   * nobody has decided on yet, then refreshes expertise: the graph is as before. An
   * approved or rejected proposal stays, because a person made that decision.
   */
  async reset(): Promise<{ deleted: number; reactivated: number; departuresUndone: string[] }> {
    if (this.running) throw new ConflictException('A live document is being processed; try again in a few seconds');
    this.running = true;
    try {
      await this.graph.query(APEX_GRAPH, Q.DELETE_OPEN_WATCHER_PROPOSALS, { createdBy: WATCHER });
      const undone = await this.graph.query<{ person: string }>(APEX_GRAPH, Q.UNDO_LIVE_DEPARTURES);
      const [deleted] = await this.graph.query<{ deleted: number }>(APEX_GRAPH, Q.DELETE_LIVE);
      const [reactivated] = await this.graph.query<{ reactivated: number }>(APEX_GRAPH, Q.REACTIVATE_DECISIONS);
      await this.graph.query(APEX_GRAPH, UPDATE_PERSON_ACTIVITY);
      await this.expertise.refresh({ graph: APEX_GRAPH });
      await this.projection.rebuild();
      return { deleted: deleted?.deleted ?? 0, reactivated: reactivated?.reactivated ?? 0, departuresUndone: undone.map((r) => r.person) };
    } finally {
      this.running = false;
    }
  }

  private async snapshot(): Promise<Snapshot> {
    const [risk, stale, people] = await Promise.all([
      this.analytics.busFactor(),
      this.analytics.staleDocs(),
      this.analytics.listPeople(false),
    ]);
    return {
      risk: new Map(risk.map((row) => [row.system, row])),
      stale,
      inactive: new Set(people.filter((p) => !p.active).map((p) => p.name)),
    };
  }
}

/**
 * The posted document as a line of artifacts.jsonl would be, so ingestion reads it
 * the same way: a Slack message is "Author: text" (one speaker, so AUTHORED), a page
 * carries an "**Author:**" line.
 */
export function toRecord(post: LivePost, id: string, day: number): ArtifactRecord {
  const slack = post.type === 'slack';
  const title = slack ? `#${post.channel ?? DEFAULT_CHANNEL}` : (post.title ?? '');
  const body = slack ? `${post.author}: ${post.text}` : `# ${title}\n**Author:** ${post.author}\n\n${post.text}`;
  return {
    doc_id: id,
    doc_type: post.type,
    title,
    body,
    day,
    date: null,
    dept: null,
    is_incident: false,
    actors: [post.author],
    tags: [],
    artifact_ids: {},
    facts: {},
  };
}

/** LIVE-20261018T143005-a1b2: sortable, unique, and clearly not a corpus id. */
export function liveId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `LIVE-${stamp}-${randomBytes(2).toString('hex')}`;
}

function staleKey(doc: StaleDoc): string {
  return `${doc.stalePage}|${doc.outdatedId}`;
}

/** Core systems whose risk level moved (or that appeared or disappeared), most at risk first. */
export function riskChanges(before: Map<string, BusFactorRow>, after: Map<string, BusFactorRow>): LiveResult['riskChanges'] {
  const order = { orphaned: 0, critical: 1, watch: 2, ok: 3 } as const;
  const systems = [...new Set([...before.keys(), ...after.keys()])];
  return systems
    .map((system) => ({ system, before: before.get(system)?.riskLevel ?? null, after: after.get(system)?.riskLevel ?? null, expertsAfter: after.get(system)?.names ?? [] }))
    .filter((row) => row.before !== row.after)
    .sort((a, b) => (a.after ? order[a.after] : 4) - (b.after ? order[b.after] : 4) || a.system.localeCompare(b.system));
}
