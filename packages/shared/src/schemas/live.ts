import { z } from 'zod';
import { RiskLevelSchema } from './analytics';
import { StaleDocSchema } from './decision';

/**
 * POST /live/artifacts: a new company document posted while Keystone runs (a Slack
 * message or a Confluence page), so the knowledge graph changes in front of you.
 */
export const LivePostSchema = z
  .object({
    type: z.enum(['slack', 'confluence']),
    /** An employee's exact name: the author of the message or page. */
    author: z.string().trim().min(1).max(100),
    /** Required for a page; a Slack message is titled by its channel. */
    title: z.string().trim().min(3).max(200).optional(),
    channel: z.string().trim().min(1).max(60).optional(),
    text: z.string().trim().min(10).max(4000),
  })
  .refine((post) => post.type === 'slack' || !!post.title, { message: 'A page needs a title', path: ['title'] });
export type LivePost = z.infer<typeof LivePostSchema>;

export const LIVE_STEPS = ['ingest', 'extract', 'embed', 'refresh', 'diff', 'act'] as const;
export const LiveStepSchema = z.enum(LIVE_STEPS);
export type LiveStep = z.infer<typeof LiveStepSchema>;

/**
 * A proposal the risk watcher made by itself after a change, with nobody asking: a
 * runbook for a system that lost its backups, a review of a page that went stale, a
 * new owner for a ticket of someone who left. A person still approves it on Audit.
 */
export const WatcherProposalSchema = z.object({
  id: z.string(),
  kind: z.enum(['reassign', 'runbook', 'review_doc']),
  /** Ticket id, system name or page id. */
  target: z.string(),
  assignee: z.string().nullable(),
  reason: z.string(),
  /** False when an open proposal for the same target already existed (it is returned instead). */
  created: z.boolean(),
});
export type WatcherProposal = z.infer<typeof WatcherProposalSchema>;

/** What changed in the company graph because of one live document. */
export const LiveResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  day: z.number().nullable(),
  /** Systems the document names, and the decisions it records (with what they are about). */
  systems: z.array(z.string()),
  decisions: z.array(z.object({ id: z.string(), summary: z.string(), systems: z.array(z.string()) })),
  /** Older decisions the new ones replaced. */
  supersedes: z.number().int(),
  /** Pages that now state a replaced decision. */
  newlyStale: z.array(StaleDocSchema),
  /** Core systems whose number of experts changed risk level (orphaned, critical, watch, ok). */
  riskChanges: z.array(z.object({ system: z.string(), before: RiskLevelSchema.nullable(), after: RiskLevelSchema.nullable(), expertsAfter: z.array(z.string()) })),
  /** People the document announces as leaving, now inactive. */
  newlyInactive: z.array(z.string()),
  /** What the risk watcher proposed because of these changes. */
  proposals: z.array(WatcherProposalSchema).default([]),
  llmCalls: z.number().int(),
  embedCalls: z.number().int(),
  ms: z.number(),
});
export type LiveResult = z.infer<typeof LiveResultSchema>;

/** The Server-Sent Events of POST /live/artifacts. */
export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), step: LiveStepSchema, status: z.enum(['start', 'done']), ms: z.number().optional(), detail: z.string().optional() }),
  z.object({ type: z.literal('done'), result: LiveResultSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

/** GET /live/artifacts: the live documents posted so far (removed together by POST /live/reset). */
export const LiveArtifactSchema = z.object({ id: z.string(), title: z.string(), type: z.string(), day: z.number().nullable(), authors: z.array(z.string()) });
export type LiveArtifact = z.infer<typeof LiveArtifactSchema>;
