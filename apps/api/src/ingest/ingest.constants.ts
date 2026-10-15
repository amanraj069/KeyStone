/** Injection token for the TextStore implementation (local disk by default). */
export const TEXT_STORE = Symbol('TEXT_STORE');

/** Injection token for ingestion settings. */
export const INGEST_SETTINGS = Symbol('INGEST_SETTINGS');

export interface IngestSettings {
  /** Folder holding artifacts.jsonl and the TextStore (DATA_DIR). */
  dataDir: string;
  /** BullMQ's Redis (REDIS_URL), never FalkorDB. */
  redisUrl: string;
  /** BullMQ queue name. Tests use their own name so a running dev worker never picks their jobs up. */
  queueName: string;
  /** Run the worker inside the API process (dev) instead of a separate worker process. */
  workerInline: boolean;
}

/** The production queue name. */
export const INGEST_QUEUE = 'ingest';

/** BullMQ job names. */
export const FULL_JOB = 'full';
export const REPLAY_JOB = 'replay';
export const EXTRACT_JOB = 'extract';

/** How many finished jobs BullMQ keeps for GET /ingest/jobs/:id. */
export const KEEP_FINISHED_JOBS = 50;
