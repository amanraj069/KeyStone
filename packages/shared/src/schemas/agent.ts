import { z } from 'zod';

/** What kind of question the agent was asked (one cheap classification call). */
export const QUESTION_LABELS = ['who_knows', 'why', 'what_if', 'freshness', 'event', 'visibility', 'counterfactual', 'general'] as const;
export const QuestionLabelSchema = z.enum(QUESTION_LABELS);
export type QuestionLabel = z.infer<typeof QuestionLabelSchema>;

/** POST /agent/ask body. */
export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  sessionId: z.string().trim().min(1).max(200).optional(),
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
});
export type Citation = z.infer<typeof CitationSchema>;

/** The Server-Sent Events of POST /agent/ask, one JSON object per event. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('classified'), label: QuestionLabelSchema }),
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
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
