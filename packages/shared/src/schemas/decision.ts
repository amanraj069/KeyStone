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
