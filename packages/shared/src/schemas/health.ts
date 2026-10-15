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

/** Response body of GET /health. */
export const HealthResponseSchema = z.object({
  falkordb: ServiceStatusSchema,
  redis: ServiceStatusSchema,
  memory: MemoryReportSchema.nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
