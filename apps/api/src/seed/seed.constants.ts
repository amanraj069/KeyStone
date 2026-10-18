import type { SeedStatus } from '@keystone/shared';

/** Injection token for the seed settings. */
export const SEED_SETTINGS = Symbol('SEED_SETTINGS');

export interface SeedSettings {
  dataDir: string;
  /** S3_BUCKET, passed to the extraction cache (which refuses it until S3 is implemented). */
  s3Bucket: string | undefined;
  embedDim: number;
  memoryWarnMb: number;
  /** "openai/text-embedding-3-small": recorded on every Chunk, and checked by search. */
  embedModel: string;
  /** EXTRACT_DEPTS: the same artifact selection the graph was originally extracted with. */
  extractDepts: string[];
  extractMaxCalls: number;
}

/** GET /health lists at most this many missing cache entries (the CLI and the log print all of them). */
export const MAX_REPORTED_MISSING = 50;

/** How often `pnpm seed` checks whether a seed started by the API has finished. */
export const WAIT_POLL_MS = 5_000;

export const IDLE_STATUS: SeedStatus = {
  state: 'idle',
  step: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  missing: [],
  missingCount: 0,
};
