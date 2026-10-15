import { z } from 'zod';

/**
 * Graphs an ingest job may write to. An allowlist, so an API caller can never
 * point ingestion (which deletes and rebuilds the graph) at another graph:
 * the main graph "apex", or a replay graph "apex_replay" optionally followed by
 * a short lowercase suffix for scratch runs (e.g. "apex_replaytest").
 */
export const IngestGraphSchema = z.union([z.literal('apex'), z.string().regex(/^apex_replay[a-z0-9_]{0,32}$/)]);
export type IngestGraph = z.infer<typeof IngestGraphSchema>;

/** POST /ingest/full body: rebuild a graph from data/artifacts.jsonl in one go. */
export const FullIngestRequestSchema = z.object({
  graph: IngestGraphSchema.default('apex'),
});
export type FullIngestRequest = z.infer<typeof FullIngestRequestSchema>;

/** POST /ingest/replay body: feed the company in day by day so the graph visibly grows. */
export const ReplayRequestSchema = z
  .object({
    graph: IngestGraphSchema.default('apex_replay'),
    fromDay: z.number().int().min(1).max(60).default(1),
    toDay: z.number().int().min(1).max(60).default(5),
    // Pause after each day so the growth can be watched (0 = as fast as possible).
    delayMs: z.number().int().min(0).max(60_000).default(2_000),
    // Start from an empty graph (true) or add on top of what is there (false).
    reset: z.boolean().default(true),
  })
  .refine((r) => r.fromDay <= r.toDay, { message: 'fromDay must be <= toDay', path: ['fromDay'] });
export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;

/**
 * POST /extract/run body: LLM extraction of systems and decisions into a graph.
 * Runs as a BullMQ job; progress arrives on the same SSE stream as ingest jobs.
 */
export const ExtractRequestSchema = z.object({
  graph: IngestGraphSchema.default('apex'),
  // Run even if more LLM calls are planned than EXTRACT_MAX_CALLS.
  force: z.boolean().default(false),
  // Ignore the extraction cache and ask the LLM again (costs money).
  refresh: z.boolean().default(false),
  // Plan and estimate only: no LLM calls, no graph writes.
  dryRun: z.boolean().default(false),
  // Only N selected artifacts (spread evenly), for trial runs.
  limit: z.number().int().min(1).max(10_000).optional(),
  // Only artifacts authored by people in these departments (overrides EXTRACT_DEPTS).
  depts: z.array(z.string().min(1)).max(20).optional(),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

/** Node and edge totals in the target graph after a step. */
export const GraphCountsSchema = z.object({
  people: z.number().int(),
  artifacts: z.number().int(),
  edges: z.number().int(),
});
export type GraphCounts = z.infer<typeof GraphCountsSchema>;

/** One progress event, sent through BullMQ and streamed to the browser over SSE. */
export const IngestProgressSchema = z.object({
  kind: z.enum(['full', 'replay', 'extract']),
  // Any graph name (tests write to test_* graphs); requests are limited by IngestGraphSchema.
  graph: z.string(),
  phase: z.string(),
  percent: z.number().min(0).max(100),
  // Set during a replay: the simulation day just loaded.
  day: z.number().int().nullable(),
  // What this step added (rows written per kind).
  added: z.record(z.string(), z.number().int()),
  totals: GraphCountsSchema,
  message: z.string(),
});
export type IngestProgress = z.infer<typeof IngestProgressSchema>;

/** POST /ingest/* reply and GET /ingest/jobs/:id. */
export const IngestJobSchema = z.object({
  jobId: z.string(),
  name: z.enum(['full', 'replay', 'extract']),
  state: z.string(),
  progress: IngestProgressSchema.nullable(),
  failedReason: z.string().nullable(),
});
export type IngestJob = z.infer<typeof IngestJobSchema>;

/** SSE message on GET /ingest/jobs/:id/events. */
export const IngestEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), jobId: z.string(), progress: IngestProgressSchema }),
  z.object({ type: z.literal('completed'), jobId: z.string() }),
  z.object({ type: z.literal('failed'), jobId: z.string(), reason: z.string() }),
]);
export type IngestEvent = z.infer<typeof IngestEventSchema>;
