import { z } from 'zod';
import { SimDaySchema } from './common';

/** What kind of change Keystone is proposing. */
export const ActionKindSchema = z.enum(['handover_plan', 'ticket_reassignment', 'runbook_task']);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/**
 * Lifecycle of a proposed action. Nothing happens until a human approves:
 * proposed -> approved | rejected.
 */
export const ActionStatusSchema = z.enum(['proposed', 'approved', 'rejected']);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** An action proposed by the agent. Mirrors the `Action` node. */
export const ActionSchema = z.object({
  id: z.string().min(1),
  kind: ActionKindSchema,
  status: ActionStatusSchema,
  day: SimDaySchema,
  // Human-readable explanation of why the agent proposed this action.
  reason: z.string().min(1),
});

export type Action = z.infer<typeof ActionSchema>;
