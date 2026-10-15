import { z } from 'zod';

/** Cuts text to at most `max` words (the model sometimes runs long; trimming beats a retry). */
function words(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((text) => text.split(/\s+/).slice(0, max).join(' '));
}

const score = z.number().min(0).max(1);

/** What the LLM returns for one artifact (step 5). */
// List limits trim instead of failing: a long answer is still usable, and a retry costs money.
export const ArtifactExtractionSchema = z.object({
  systems: z
    .array(z.object({ name: z.string().trim().min(1).max(80), relevance: score }))
    .transform((items) => items.slice(0, 10)),
  decisions: z
    .array(
      z.object({
        summary: words(30),
        systems: z.array(z.string().trim().min(1).max(80)).max(10),
        kind: z.enum(['adopt', 'deprecate', 'change', 'policy']),
        confidence: score,
      }),
    )
    .transform((items) => items.slice(0, 5)),
  asserts: z
    .array(z.object({ claim: words(25), system: z.string().trim().min(1).max(80) }))
    .transform((items) => items.slice(0, 5)),
});
export type ArtifactExtraction = z.infer<typeof ArtifactExtractionSchema>;

/** Items below these scores are discarded before anything is written. */
export const MIN_DECISION_CONFIDENCE = 0.7;
export const MIN_SYSTEM_RELEVANCE = 0.4;

/** What the LLM returns in the second pass for one system (step 7). */
export const SystemLinksSchema = z.object({
  supersedes: z.array(z.object({ newerId: z.string().min(1), olderId: z.string().min(1) })).max(200),
  asserts: z.array(z.object({ pageId: z.string().min(1), decisionId: z.string().min(1) })).max(200),
});
export type SystemLinks = z.infer<typeof SystemLinksSchema>;
