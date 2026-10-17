import { z } from 'zod';
import { SimDaySchema } from './common';

/** What Keystone proposes: move a ticket, write a runbook, review a page, or a handover plan grouping those. */
export const ACTION_KINDS = ['reassign', 'runbook', 'review_doc', 'handover'] as const;
export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/**
 * Lifecycle of a proposed action. Nothing happens until a human approves:
 * proposed -> approved | rejected.
 */
export const ACTION_STATUSES = ['proposed', 'approved', 'rejected'] as const;
export const ActionStatusSchema = z.enum(ACTION_STATUSES);
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

/** GET /actions: one action with what it targets, who would do it, and the artifacts behind it. */
export const ActionRowSchema = z.object({
  id: z.string(),
  kind: ActionKindSchema,
  status: ActionStatusSchema,
  day: z.number(),
  reason: z.string(),
  summary: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.number(),
  approvedAt: z.number().nullable(),
  rejectedAt: z.number().nullable(),
  rejectReason: z.string().nullable(),
  /** Ticket, Page, System or Person. */
  targetType: z.string().nullable(),
  target: z.string().nullable(),
  targetTitle: z.string().nullable(),
  assignee: z.string().nullable(),
  planId: z.string().nullable(),
  children: z.array(z.string()),
  evidence: z.array(z.object({ id: z.string(), title: z.string().nullable(), type: z.string().nullable() })),
});
export type ActionRow = z.infer<typeof ActionRowSchema>;

/** POST /actions/:id/approve: the approved action and how many ASSIGNED edges moved. */
export const ApprovedActionSchema = ActionRowSchema.extend({ moved: z.number().int() });
export type ApprovedAction = z.infer<typeof ApprovedActionSchema>;

/** POST /actions/handover: the plan, its child actions, and what the plan could not cover. */
export const HandoverPlanSchema = z.object({
  plan: ActionRowSchema,
  /** False when an open plan for this person already existed and was returned instead. */
  created: z.boolean(),
  children: z.array(ActionRowSchema),
  skipped: z.array(z.object({ kind: ActionKindSchema, target: z.string(), reason: z.string(), existing: z.string().optional() })),
});
export type HandoverPlan = z.infer<typeof HandoverPlanSchema>;
