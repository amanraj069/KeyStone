/** Injection token for what-if settings. */
export const WHATIF_SETTINGS = Symbol('WHATIF_SETTINGS');

export interface WhatIfSettings {
  /** At most this many simulations run at once (env WHATIF_MAX_CONCURRENT). */
  maxConcurrent: number;
  /** The live company graph: validated and read, never copied or written. */
  sourceGraph: string;
  /** The projection that is copied for each simulation. */
  projectionGraph: string;
  /** Scratch graphs are named `${scratchPrefix}<id>`; the sweepers delete leftovers with this prefix. */
  scratchPrefix: string;
}

export const DEFAULT_WHATIF_MAX_CONCURRENT = 2;
export const SCRATCH_PREFIX = 'apex_whatif_';

/**
 * A scratch graph older than this is a leftover. Simulations take well under a
 * second; the margin keeps a sweeper in one process (the API, or the stdio MCP
 * server) from deleting a copy another process is still using.
 */
export const SCRATCH_MAX_AGE_MS = 10 * 60 * 1000;

/** The hourly sweeper's interval. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** GET /whatif/candidates is cached this long. */
export const CANDIDATES_TTL_MS = 60 * 1000;

/** The animation subgraph shows at most this many of the person's systems (fewest backups first). */
export const MAX_SUBGRAPH_SYSTEMS = 30;
