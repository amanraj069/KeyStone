import { z } from 'zod';

export const ServiceStatusSchema = z.enum(['up', 'down']);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

/** Memory used by one graph, from GRAPH.MEMORY USAGE (null if unsupported). */
export const GraphMemorySchema = z.object({
  graph: z.string(),
  totalMb: z.number().nullable(),
});

/** Memory figures for the FalkorDB server. */
export const MemoryReportSchema = z.object({
  // used_memory_human from INFO memory, e.g. "3.21M".
  usedMemoryHuman: z.string().nullable(),
  // used_memory from INFO memory, converted from bytes to MB (for budgets).
  usedMemoryMb: z.number().nullable(),
  graphs: z.array(GraphMemorySchema),
});
export type MemoryReport = z.infer<typeof MemoryReportSchema>;

/**
 * Overall status: "up" = both services up and apex has people; "seeding" = apex is
 * being restored or rebuilt from files; "degraded" = services up but apex is empty
 * (e.g. the seed failed); "down" = FalkorDB or Redis is not answering.
 */
export const OverallStatusSchema = z.enum(['up', 'seeding', 'degraded', 'down']);
export type OverallStatus = z.infer<typeof OverallStatusSchema>;

/** What this API process's seed (or startup restore) is doing. */
export const SeedStatusSchema = z.object({
  state: z.enum(['idle', 'restoring', 'seeding', 'done', 'failed']),
  // The stage running now, e.g. "embeddings from cache (Stage 6)".
  step: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
  // Cache entries the seed needed but did not find (first 50; missingCount is the total).
  missing: z.array(z.string()),
  missingCount: z.number().int(),
});
export type SeedStatus = z.infer<typeof SeedStatusSchema>;

/** Response body of GET /health. */
export const HealthResponseSchema = z.object({
  status: OverallStatusSchema,
  falkordb: ServiceStatusSchema,
  redis: ServiceStatusSchema,
  memory: MemoryReportSchema.nullable(),
  // The company graph and its Person count (null when it could not be read).
  graph: z.object({ name: z.string(), people: z.number().int().nullable() }),
  seed: SeedStatusSchema.nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
