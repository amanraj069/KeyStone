import { z } from 'zod';

/** GET /search and /search/vector-only query string. Values arrive as strings. */
export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'q is required').max(500),
  k: z.coerce.number().int().min(1).max(50).default(10),
  // Only artifacts up to this simulation day (hybrid search only).
  asOfDay: z.coerce.number().int().min(0).max(1000).optional(),
  // Only artifacts from this simulation day on (hybrid search only); with asOfDay, a day range.
  fromDay: z.coerce.number().int().min(0).max(1000).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** One retrieved chunk with its artifact; graph fields are empty for vector-only results. */
export const SearchHitSchema = z.object({
  chunkId: z.string(),
  artifactId: z.string(),
  title: z.string().nullable(),
  type: z.string().nullable(),
  day: z.number().int().nullable(),
  // FalkorDB cosine distance (0 = identical) and 1 - distance for readability.
  distance: z.number(),
  similarity: z.number(),
  text: z.string(),
  // Artifacts linked within 2 REFERENCES hops, and the people who wrote this one.
  related: z.array(z.string()),
  authors: z.array(z.string()),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  mode: z.enum(['hybrid', 'vector-only']),
  k: z.number().int(),
  // Time to embed the question and time for the graph query + text lookup.
  embedMs: z.number(),
  searchMs: z.number(),
  hits: z.array(SearchHitSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
