import { z } from 'zod';

/** POST /memory/turns/:id/feedback: a rating, and on a thumbs-down an optional correction. */
export const FeedbackRequestSchema = z.object({
  userId: z.string().trim().min(1).max(200).optional(),
  rating: z.enum(['up', 'down']),
  /** What is wrong or missing, in the user's words. Becomes a proposed Note for review. */
  correction: z.string().trim().min(3).max(1000).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const FeedbackResponseSchema = z.object({
  turnId: z.string(),
  rating: z.enum(['up', 'down']),
  /** The proposed Note created from the correction, if one was given. */
  noteId: z.string().nullable(),
});
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

export const NOTE_STATUSES = ['proposed', 'approved', 'rejected'] as const;
export const NoteStatusSchema = z.enum(NOTE_STATUSES);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

/** A colleague's correction, kept in the graph. Only approved notes reach the agent. */
export const NoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: NoteStatusSchema,
  day: z.number().nullable(),
  createdAt: z.number(),
  reviewedAt: z.number().nullable(),
  reason: z.string().nullable(),
  /** The systems and people the corrected answer was about. */
  subjects: z.array(z.string()),
  /** The question whose answer it corrects. */
  question: z.string().nullable(),
  turnId: z.string().nullable(),
  /** Artifacts the corrected answer cited. */
  evidence: z.array(z.string()),
});
export type Note = z.infer<typeof NoteSchema>;

/** GET /memory/sessions?userId=: a user's chats, newest first. */
export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.number(),
  lastAt: z.number(),
  turns: z.number().int(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** What Keystone remembers about one system or person (GET /memory/about, the recall_memory tool). */
export const RecallSchema = z.object({
  subject: z.string(),
  kind: z.enum(['system', 'person']),
  timesAsked: z.number().int(),
  notes: z.array(z.object({ id: z.string(), text: z.string(), day: z.number().nullable() })),
  pastQuestions: z.array(z.object({ question: z.string(), summary: z.string(), at: z.number() })),
});
export type Recall = z.infer<typeof RecallSchema>;
