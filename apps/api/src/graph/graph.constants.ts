/** Injection token for the plain connection settings GraphService needs. */
export const FALKOR_SETTINGS = Symbol('FALKOR_SETTINGS');

/** Connection settings for FalkorDB. Built from env vars, never hard-coded. */
export interface FalkorSettings {
  host: string;
  port: number;
  password: string;
}

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
