import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ExpertiseService } from '../analytics/expertise.service';
import { APEX_GRAPH, BACKUP_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { ProjectionService } from '../projection/projection.service';
import { type ActionsRestoreSummary, ActionsExportService } from './actions-export.service';
import { MemoryExportService } from './memory-export.service';
import { BACKUP_SETTINGS, BACKUP_WAIT_MS, type BackupSettings } from './backup.constants';
import { countPeople } from './count-people';
import { GraphLock } from './graph-lock';

export type BackupResult =
  | { status: 'done'; graph: string; people: number; ms: number }
  | { status: 'skipped'; reason: string };

export interface RestoreResult {
  status: 'done';
  people: number;
  /** Actions from actions-latest.jsonl merged back in (null when not asked for). */
  actions: ActionsRestoreSummary | null;
  ms: number;
}

/**
 * Backups of apex inside FalkorDB: GRAPH.COPY apex -> apex_backup (every 6 hours,
 * from the worker) and the way back (POST /admin/restore, or API startup when apex
 * is empty). Every step holds the graph lock, so a backup never copies a graph that
 * a seed or restore is still building.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly lock: GraphLock,
    private readonly actionsExport: ActionsExportService,
    private readonly expertise: ExpertiseService,
    private readonly projection: ProjectionService,
    @Inject(BACKUP_SETTINGS) private readonly settings: BackupSettings,
    @Optional() private readonly memoryExport?: MemoryExportService,
  ) {}

  /**
   * Copies apex into a new apex_backup, replacing the old one only once the copy has
   * succeeded. Skipped (old backup kept) when apex has no people, when another graph
   * operation runs, or when the copy would push FalkorDB above MEMORY_MAX_MB.
   */
  async backupNow(): Promise<BackupResult> {
    const handle = await this.lock.acquire('backup');
    if (!handle) return this.skip(`a ${(await this.lock.holder())?.op ?? 'graph operation'} is running`);
    try {
      const people = await countPeople(this.graph, APEX_GRAPH);
      if (people === 0) return this.skip(`${APEX_GRAPH} has no Person nodes; keeping the old backup`);
      const room = await this.memoryAfterCopyMb();
      if (room !== null && room > this.settings.memoryMaxMb) {
        return this.skip(`the copy would use about ${Math.round(room)} MB, above MEMORY_MAX_MB (${this.settings.memoryMaxMb})`);
      }

      const started = performance.now();
      // Copy, then rename over the old backup: if the copy fails, the old backup is still there.
      await this.graph.replaceGraph(APEX_GRAPH, BACKUP_GRAPH);
      const copied = await countPeople(this.graph, BACKUP_GRAPH);
      const ms = Math.round(performance.now() - started);
      this.logger.log(`Backed up ${APEX_GRAPH} to ${BACKUP_GRAPH} (${copied} people) in ${ms} ms`);
      return { status: 'done', graph: BACKUP_GRAPH, people: copied, ms };
    } finally {
      await this.lock.release(handle);
    }
  }

  /** True if apex_backup exists and has people (something worth restoring). */
  async hasBackup(): Promise<boolean> {
    return (await countPeople(this.graph, BACKUP_GRAPH)) > 0;
  }

  /**
   * Replaces apex with a copy of apex_backup, then rebuilds apex_proj (its freshness
   * stamp would otherwise still match the newer apex). With reapplyActions, actions
   * from actions-latest.jsonl are merged back in (only adds or moves forward, never
   * undoes an approval) and expertise is refreshed, so approvals made after the
   * backup are not lost.
   */
  async restore(options: { reapplyActions: boolean }): Promise<RestoreResult> {
    const handle = await this.lock.acquire('restore', BACKUP_WAIT_MS);
    if (!handle) throw new ConflictException(`A ${(await this.lock.holder())?.op ?? 'graph operation'} is running; try again when it finishes`);
    try {
      if (!(await this.hasBackup())) throw new NotFoundException(`${BACKUP_GRAPH} is missing or has no Person nodes`);
      const started = performance.now();
      // Approvals made since the last 6-hourly export exist only in the apex being replaced.
      const live = options.reapplyActions ? await this.actionsExport.snapshotActions(APEX_GRAPH) : [];
      // The same for the agent's memory: chats and approved notes since the backup.
      const liveMemory = options.reapplyActions && this.memoryExport ? await this.memoryExport.snapshotMemory(APEX_GRAPH) : [];
      await this.graph.replaceGraph(BACKUP_GRAPH, APEX_GRAPH);
      const actions = options.reapplyActions ? await this.actionsExport.restoreLatestInto(APEX_GRAPH, live) : null;
      if (options.reapplyActions && this.memoryExport) await this.memoryExport.restoreLatestInto(APEX_GRAPH, liveMemory);
      if (actions && actions.actions > 0) await this.expertise.refresh({ graph: APEX_GRAPH });
      await this.projection.rebuild();
      const people = await countPeople(this.graph, APEX_GRAPH);
      const ms = Math.round(performance.now() - started);
      this.logger.log(`Restored ${APEX_GRAPH} from ${BACKUP_GRAPH} (${people} people) in ${ms} ms`);
      return { status: 'done', people, actions, ms };
    } finally {
      await this.lock.release(handle);
    }
  }

  /**
   * FalkorDB memory at the peak of a backup, or null if unknown: the old apex_backup
   * stays until the new copy is renamed over it, so for a moment both exist.
   */
  private async memoryAfterCopyMb(): Promise<number | null> {
    const report = await this.graph.memoryReport();
    const sizeOf = (name: string) => report.graphs.find((g) => g.graph === name)?.totalMb ?? 0;
    if (report.usedMemoryMb === null) return null;
    return report.usedMemoryMb + sizeOf(APEX_GRAPH);
  }

  private skip(reason: string): BackupResult {
    this.logger.warn(`Backup skipped: ${reason}`);
    return { status: 'skipped', reason };
  }
}
