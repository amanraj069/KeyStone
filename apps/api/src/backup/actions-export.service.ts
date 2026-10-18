import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APEX_GRAPH } from '../graph/graph.constants';
import { type BatchRow, GraphService } from '../graph/graph.service';
import { EXPORT_PAGE, EXPORT_STORE, EXPORTS_DIR, LATEST_ACTIONS_EXPORT, RESTORE_BATCH } from './backup.constants';
import { countPeople } from './count-people';
import type { ExportStore } from './export-store';
import { GraphLock } from './graph-lock';
import * as Q from './queries/backup.queries';

/** One line of actions-*.jsonl: an Action node with its edges (EXPORT_ACTIONS). */
export const ExportedActionSchema = z.object({
  id: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  targetType: z.string().nullable(),
  target: z.string().nullable(),
  assignsTo: z.string().nullable(),
  partOfPlan: z.string().nullable(),
  basedOn: z.array(z.string()),
});
export type ExportedAction = z.infer<typeof ExportedActionSchema>;

export type ExportResult =
  | { status: 'done'; actions: number; files: string[] }
  | { status: 'skipped'; reason: string };

export interface ActionsRestoreSummary {
  /** Where the actions came from, or null if there was no export to restore. */
  source: string | null;
  actions: number;
  /** Approved reassignments whose ticket move was re-applied. */
  reassignments: number;
  /** Actions whose target no longer exists in the graph (kept, but without a TARGETS edge). */
  unresolvedTargets: string[];
}

/**
 * Actions are the one thing in the graph a person creates (approvals), so they
 * cannot be rebuilt from artifacts.jsonl. This service writes them to
 * exports/actions-<timestamp>.jsonl plus actions-latest.jsonl, and puts them back
 * into a graph (the seed command; a restore from apex_backup).
 */
@Injectable()
export class ActionsExportService {
  private readonly logger = new Logger(ActionsExportService.name);

  constructor(
    private readonly graph: GraphService,
    @Inject(EXPORT_STORE) private readonly store: ExportStore,
    private readonly lock: GraphLock,
  ) {}

  /**
   * Exports every Action of apex. Skipped while a seed or restore is running, or if
   * apex has no people: an export of a half-built graph would overwrite
   * actions-latest.jsonl with fewer actions than really exist.
   */
  async exportNow(graphName = APEX_GRAPH): Promise<ExportResult> {
    const holder = await this.lock.holder();
    if (holder && holder.op !== 'backup') return this.skip(`a ${holder.op} is running`);
    if ((await countPeople(this.graph, graphName)) === 0) return this.skip(`${graphName} has no Person nodes`);
    return this.writeExport(graphName);
  }

  /**
   * Writes the export without the lock and people checks. For a caller that already
   * holds the graph lock and knows the graph is complete: a restore or forced seed
   * refreshes actions-latest.jsonl first, so approvals since the last 6-hourly export
   * survive the rebuild.
   */
  async writeExport(graphName: string): Promise<ExportResult> {
    const actions = await this.readActions(graphName);
    const files = await this.save(actions, [`${EXPORTS_DIR}/actions-${fileStamp(new Date())}.jsonl`, LATEST_ACTIONS_EXPORT]);
    return { status: 'done', actions: actions.length, files };
  }

  /**
   * The actions of `graphName` just before it is replaced (restore, `pnpm seed --force`),
   * saved to exports/actions-<timestamp>-before-replace.jsonl and returned. It never
   * overwrites actions-latest.jsonl: the graph being replaced may be the broken one (an
   * accidental full ingest leaves people but no actions), and its empty list must not
   * erase the last good export. Callers merge both (restoreLatestInto's `extra`).
   */
  async snapshotActions(graphName: string): Promise<ExportedAction[]> {
    if ((await countPeople(this.graph, graphName)) === 0) return [];
    const actions = await this.readActions(graphName);
    await this.save(actions, [`${EXPORTS_DIR}/actions-${fileStamp(new Date())}-before-replace.jsonl`]);
    return actions;
  }

  private async save(actions: ExportedAction[], keys: string[]): Promise<string[]> {
    const body = actions.map((action) => JSON.stringify(action)).join('\n') + (actions.length > 0 ? '\n' : '');
    for (const key of keys) await this.store.put(key, body);
    const files = keys.map((key) => this.store.locate(key));
    this.logger.log(`Exported ${actions.length} actions to ${files.join(' and ')}`);
    return files;
  }


  /** Every Action with its edges, page by page. */
  async readActions(graphName: string): Promise<ExportedAction[]> {
    const actions: ExportedAction[] = [];
    for (let skip = 0; ; skip += EXPORT_PAGE) {
      const page = await this.graph.roQuery<ExportedAction>(graphName, Q.EXPORT_ACTIONS, { skip, limit: EXPORT_PAGE });
      actions.push(...page.map((row) => ExportedActionSchema.parse(row)));
      if (page.length < EXPORT_PAGE) return actions;
    }
  }

  /** The actions in actions-latest.jsonl, or null if there is no export yet. */
  async readLatest(): Promise<ExportedAction[] | null> {
    const text = await this.store.get(LATEST_ACTIONS_EXPORT);
    if (text === null) return null;
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        const parsed = ExportedActionSchema.safeParse(JSON.parse(line));
        if (!parsed.success) throw new Error(`${LATEST_ACTIONS_EXPORT} line ${index + 1} is not a valid action: ${parsed.error.message}`);
        return parsed.data;
      });
  }

  /**
   * Restores actions-latest.jsonl into `graphName`, then `extra` (a snapshotActions of
   * the graph that was just replaced). Restoring only moves an action forward
   * (proposed -> approved or rejected), so the newer of the two always wins.
   */
  async restoreLatestInto(graphName: string, extra: ExportedAction[] = []): Promise<ActionsRestoreSummary> {
    const latest = await this.readLatest();
    if (latest === null && extra.length === 0) {
      this.logger.log(`No ${LATEST_ACTIONS_EXPORT} yet; no actions to restore`);
      return { source: null, actions: 0, reassignments: 0, unresolvedTargets: [] };
    }
    // Two passes, oldest first, so one statement never holds the same action id twice.
    const fromLatest = await this.restoreInto(graphName, latest ?? []);
    const fromExtra = await this.restoreInto(graphName, extra);
    return {
      source: latest === null ? null : this.store.locate(LATEST_ACTIONS_EXPORT),
      actions: new Set([...(latest ?? []), ...extra].map((a) => a.id)).size,
      reassignments: Math.max(fromLatest.reassignments, fromExtra.reassignments),
      unresolvedTargets: [...new Set([...fromLatest.unresolvedTargets, ...fromExtra.unresolvedTargets])],
    };
  }

  /**
   * Writes the actions into `graphName`: nodes first (so every plan exists), then
   * their edges, then the ticket moves of approved reassignments, in approval order.
   */
  async restoreInto(graphName: string, actions: ExportedAction[]): Promise<ActionsRestoreSummary> {
    if (actions.length === 0) return { source: null, actions: 0, reassignments: 0, unresolvedTargets: [] };
    // props came from properties(act), so they are plain property values FalkorDB accepts back.
    await this.graph.batchWrite(graphName, Q.RESTORE_ACTION_NODES, actions.map((a) => ({ id: a.id, props: a.props as BatchRow })));

    const unresolvedTargets: string[] = [];
    for (let start = 0; start < actions.length; start += RESTORE_BATCH) {
      const rows = actions
        .slice(start, start + RESTORE_BATCH)
        .map((a) => ({ id: a.id, targetType: a.targetType, target: a.target, assignsTo: a.assignsTo, partOfPlan: a.partOfPlan, basedOn: a.basedOn }));
      const linked = await this.graph.query<{ id: string; targetFound: boolean }>(graphName, Q.RESTORE_ACTION_EDGES, { rows });
      unresolvedTargets.push(...linked.filter((row) => !row.targetFound).map((row) => row.id));
    }

    const approved = await this.graph.roQuery<{ id: string }>(graphName, Q.APPROVED_REASSIGNMENTS);
    for (const { id } of approved) await this.graph.query(graphName, Q.REAPPLY_APPROVED_REASSIGNMENT, { id });

    if (unresolvedTargets.length > 0) {
      this.logger.warn(`${unresolvedTargets.length} restored actions lost their target: ${unresolvedTargets.slice(0, 10).join(', ')}`);
    }
    this.logger.log(`Restored ${actions.length} actions into ${graphName}; re-applied ${approved.length} approved reassignments`);
    return { source: null, actions: actions.length, reassignments: approved.length, unresolvedTargets };
  }

  private skip(reason: string): ExportResult {
    this.logger.warn(`Actions export skipped: ${reason}`);
    return { status: 'skipped', reason };
  }
}

/** 2026-10-17T20:30:05.123Z -> 2026-10-17T20-30-05Z (safe in file names and S3 keys). */
export function fileStamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}
