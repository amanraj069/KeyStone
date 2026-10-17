import { z } from 'zod';
import { SimDaySchema } from './common';

export const DecisionStatusSchema = z.enum(['active', 'superseded', 'reverted']);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** A decision extracted from artifacts. Mirrors the `Decision` node. */
export const DecisionSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  day: SimDaySchema,
  status: DecisionStatusSchema,
});

export type Decision = z.infer<typeof DecisionSchema>;

/** GET /systems/:name/decisions (K10a): one decision, its source, and the decision it replaced. */
export const DecisionTraceRowSchema = z.object({
  id: z.string(),
  summary: z.string(),
  day: z.number().nullable(),
  kind: z.string(),
  status: z.string(),
  /** The artifact it was decided in, its type, and the people on it. */
  source: z.string(),
  sourceType: z.string(),
  authors: z.array(z.string()),
  /** The earlier decision this one SUPERSEDES, if any. */
  replacedId: z.string().nullable(),
  replaced: z.string().nullable(),
});
export type DecisionTraceRow = z.infer<typeof DecisionTraceRowSchema>;

/** GET /analytics/stale-docs (K10b): a page still asserting a decision that was replaced. */
export const StaleDocSchema = z.object({
  stalePage: z.string(),
  pageTitle: z.string(),
  outdatedId: z.string(),
  outdatedClaim: z.string(),
  currentId: z.string(),
  currentDecision: z.string(),
  decidedOn: z.number().nullable(),
  decidedIn: z.string().nullable(),
});
export type StaleDoc = z.infer<typeof StaleDocSchema>;

/** GET /systems: systems with decisions (core ones, and any with a replaced decision). */
export const SystemWithDecisionsSchema = z.object({
  name: z.string(),
  core: z.boolean(),
  decisions: z.number().int(),
  /** Decisions that replaced an earlier one. */
  changes: z.number().int(),
});
export type SystemWithDecisions = z.infer<typeof SystemWithDecisionsSchema>;
