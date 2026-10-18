import { z } from 'zod';

/** What kind of question the agent was asked (one cheap classification call). */
export const QUESTION_LABELS = ['who_knows', 'why', 'what_if', 'freshness', 'event', 'visibility', 'counterfactual', 'general'] as const;
export const QuestionLabelSchema = z.enum(QUESTION_LABELS);
export type QuestionLabel = z.infer<typeof QuestionLabelSchema>;

/** POST /agent/ask body. */
export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** The chat: earlier questions of the same session are remembered for follow-ups. */
  sessionId: z.string().trim().min(1).max(200).optional(),
  /** Who is asking (an anonymous id the browser keeps), so each user's chats stay theirs. */
  userId: z.string().trim().min(1).max(200).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/**
 * A graph returned by a tool, to draw. Its node shapes differ per tool (who_knows
 * returns database nodes with numeric ids, simulate_departure named nodes like
 * "person:Ada" with flags), so the UI normalises them.
 */
export const GraphPathSchema = z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) });
export type GraphPath = z.infer<typeof GraphPathSchema>;

/** A cited artifact, with what the UI shows for it. */
export const CitationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  day: z.number().nullable(),
  /** The sentence in the document that names what the answer is about (a system or person), when one does. */
  passage: z.string().nullable().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** The Server-Sent Events of POST /agent/ask, one JSON object per event. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('classified'), label: QuestionLabelSchema }),
  /** What the agent recalled from memory before answering: earlier turns of this chat and approved notes. */
  z.object({
    type: z.literal('memory'),
    priorTurns: z.number().int(),
    notes: z.array(z.object({ id: z.string(), text: z.string() })),
    subjects: z.array(z.string()),
  }),
  z.object({ type: z.literal('tool_call'), name: z.string(), args: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal('tool_result'),
    name: z.string(),
    summary: z.string(),
    evidenceCount: z.number().int(),
    graphPath: GraphPathSchema.nullable(),
  }),
  z.object({ type: z.literal('answer_delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    citations: z.array(CitationSchema),
    graphPath: GraphPathSchema,
    timings: z.record(z.string(), z.number()),
    /** The Turn this answer was stored as (for feedback); null when memory is off or storing failed. */
    turnId: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
