/** Injection token for the plain settings GraphService needs. */
export const FALKOR_SETTINGS = Symbol('FALKOR_SETTINGS');

/** Injection token for the validated embedding size (EMBED_DIM). */
export const EMBED_DIM = Symbol('EMBED_DIM');

/** Settings for GraphService. Built from env vars, never hard-coded. */
export interface FalkorSettings {
  host: string;
  port: number;
  password: string;
  /** assertMemoryBudget warns above this many MB used by FalkorDB. */
  memoryWarnMb: number;
  /** assertMemoryBudget throws above this many MB used by FalkorDB. */
  memoryMaxMb: number;
}

/** The main company graph (AGENTS.md section 5). */
export const APEX_GRAPH = 'apex';

/**
 * Tiny, always-empty graph that GET /health runs `RETURN 1` against.
 * Read-only queries fail on a graph that does not exist yet, so health uses a
 * dedicated name instead of creating `apex` early.
 */
export const HEALTH_GRAPH = 'keystone_health';

/** Reconnect delays: 200 ms, 400 ms, 800 ms ... capped at 10 s. */
export const BACKOFF_BASE_MS = 200;
export const BACKOFF_MAX_MS = 10_000;

/** Queries slower than this are logged as warnings instead of debug lines. */
export const SLOW_QUERY_MS = 500;

/** Rows per UNWIND batch in batchWrite: big enough to be fast, small enough to keep queries short. */
export const DEFAULT_BATCH_SIZE = 500;
