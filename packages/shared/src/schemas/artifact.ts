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

/** GET /artifacts/:id: what the UI shows when an artifact is opened (the body from the TextStore, whole unless outsized). */
export const ArtifactDetailSchema = z.object({
  id: z.string(),
  /** The artifact's kind as a graph label: Ticket, Page, Thread, PR, Email, Meeting, Alert or Record. */
  label: z.string().nullable(),
  /** The OrgForge doc_type, e.g. jira, confluence, slack. */
  type: z.string().nullable(),
  title: z.string().nullable(),
  day: z.number().int().nullable(),
  /** People who wrote, reviewed, own or took part in it. */
  people: z.array(z.string()),
  excerpt: z.string().nullable(),
  bodyLength: z.number().int().nullable(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;
