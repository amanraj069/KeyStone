import { z } from 'zod';
import { SimDaySchema } from './common';

/**
 * Artifact kinds. Each one is also an extra node label in the graph,
 * e.g. (:Artifact:Ticket).
 */
export const ArtifactTypeSchema = z.enum(['Ticket', 'Page', 'Thread', 'PR', 'Email']);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

/**
 * A document produced by the company. Mirrors the `Artifact` node.
 * The body text is NOT here: it lives in the TextStore, keyed by `id`.
 */
export const ArtifactSchema = z.object({
  id: z.string().min(1),
  type: ArtifactTypeSchema,
  title: z.string(),
  day: SimDaySchema,
  isIncident: z.boolean(),
  // Length of the body in characters, so the UI can show size without loading text.
  bodyLength: z.number().int().nonnegative(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
