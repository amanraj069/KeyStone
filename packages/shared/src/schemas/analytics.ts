import { z } from 'zod';
import { MemoryReportSchema } from './health';

/** Bus factor risk level by number of active experts: 0 orphaned, 1 critical, 2 watch, 3+ ok. */
export const RiskLevelSchema = z.enum(['orphaned', 'critical', 'watch', 'ok']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** GET /analytics/summary: dashboard counts for one graph (apex, or a replay graph). */
export const AnalyticsSummarySchema = z.object({
  /** The graph the numbers come from. */
  graph: z.string(),
  /** The latest day of company data in that graph. */
  day: z.number().int().nullable(),
  people: z.object({ active: z.number().int(), inactive: z.number().int() }),
  /** Core systems per risk level. */
  systems: z.record(RiskLevelSchema, z.number().int()),
  minScore: z.number(),
  staleDocs: z.number().int(),
  openTickets: z.number().int(),
  memory: MemoryReportSchema,
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;

/** GET /analytics/bus-factor: one core system. `evidence[i]` belongs to `names[i]`. */
export const BusFactorRowSchema = z.object({
  system: z.string(),
  experts: z.number().int(),
  riskLevel: RiskLevelSchema,
  names: z.array(z.string()),
  evidence: z.array(z.array(z.string())),
});
export type BusFactorRow = z.infer<typeof BusFactorRowSchema>;

/** GET /analytics/bridges: one of the people who connect teams. */
export const BridgeSchema = z.object({
  person: z.string(),
  score: z.number(),
  dept: z.string().nullable(),
  evidence: z.array(z.string()),
});
export type Bridge = z.infer<typeof BridgeSchema>;

/** A node of a graph drawn in the UI: the database id, the most specific label and a readable name. */
export const ViewNodeSchema = z.object({
  id: z.number(),
  label: z.string(),
  name: z.string(),
  /** The artifact's business id, for artifacts (so the UI can cite and open it). */
  artifactId: z.string().nullable(),
});
export type ViewNode = z.infer<typeof ViewNodeSchema>;

export const ViewEdgeSchema = z.object({ id: z.number(), type: z.string(), source: z.number(), target: z.number() });
export type ViewEdge = z.infer<typeof ViewEdgeSchema>;

export const GraphViewSchema = z.object({ nodes: z.array(ViewNodeSchema), edges: z.array(ViewEdgeSchema) });
export type GraphView = z.infer<typeof GraphViewSchema>;

export const ExpertSchema = z.object({
  person: z.string(),
  score: z.number(),
  lastActive: z.number(),
  evidence: z.array(z.string()),
});
export type Expert = z.infer<typeof ExpertSchema>;

/** GET /systems/:name/experts: the top experts and the evidence graph of the strongest one. */
export const ExpertsResponseSchema = z.object({
  system: z.string(),
  experts: z.array(ExpertSchema),
  evidencePath: GraphViewSchema.extend({ person: z.string(), evidence: z.array(z.string()) }).nullable(),
});
export type ExpertsResponse = z.infer<typeof ExpertsResponseSchema>;
