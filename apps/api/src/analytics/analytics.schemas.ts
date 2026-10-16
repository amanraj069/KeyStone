import { z } from 'zod';

/** A system or person name from the URL path. */
export const NameParamSchema = z.string().trim().min(1).max(200);

/** Optional ?minScore= (KNOWS score threshold for "is an expert"). */
export const MinScoreQuerySchema = z.object({
  minScore: z.coerce.number().min(0).max(1000).optional(),
});
