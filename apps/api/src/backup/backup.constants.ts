/** Injection tokens for the backup module. */
export const BACKUP_SETTINGS = Symbol('BACKUP_SETTINGS');
export const EXPORT_STORE = Symbol('EXPORT_STORE');
export const GRAPH_LOCK_REDIS = Symbol('GRAPH_LOCK_REDIS');

export interface BackupSettings {
  /** BullMQ's Redis (REDIS_URL), never FalkorDB. */
  redisUrl: string;
  /** A backup is skipped if copying apex would push FalkorDB above this (MEMORY_MAX_MB). */
  memoryMaxMb: number;
  /** How often the worker backs up apex and exports actions. */
  everyMs: number;
}

/** BullMQ queue for backups and exports. Separate from "ingest", so they never show up as ingest jobs. */
export const MAINTENANCE_QUEUE = 'maintenance';

/** BullMQ job (and job scheduler) names. */
export const BACKUP_JOB = 'backup-graph';
export const EXPORT_ACTIONS_JOB = 'export-actions';

/** Backups and action exports run every 6 hours. */
export const MAINTENANCE_EVERY_MS = 6 * 60 * 60 * 1000;

/** How many finished maintenance jobs BullMQ keeps (for debugging with redis-cli). */
export const KEEP_MAINTENANCE_JOBS = 20;

/**
 * One Redis key guards every operation that replaces a whole graph (seed, restore,
 * backup), so two of them never run at once, even in different containers.
 */
export const GRAPH_LOCK_KEY = 'keystone:graph-lock';

/** The lock expires this long after its holder stops renewing it (e.g. the process died). */
export const GRAPH_LOCK_TTL_MS = 3 * 60_000;

/** Seed and restore wait up to this long for a running backup to give the lock back. */
export const BACKUP_WAIT_MS = 2 * 60_000;

/** How often a waiting acquire looks at the lock again. */
export const LOCK_POLL_MS = 1_000;

/** Action exports live under this folder of the export store (DATA_DIR/exports locally). */
export const EXPORTS_DIR = 'exports';

/** The export the seed command restores actions from. */
export const LATEST_ACTIONS_EXPORT = `${EXPORTS_DIR}/actions-latest.jsonl`;

/** Actions read per page when exporting (well under FalkorDB's RESULTSET_SIZE). */
export const EXPORT_PAGE = 1000;

/** Actions linked per query when restoring (each row also unwinds its evidence ids). */
export const RESTORE_BATCH = 200;
