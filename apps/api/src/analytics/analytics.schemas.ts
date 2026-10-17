import { IngestGraphSchema } from '@keystone/shared';
import { z } from 'zod';

/** A system or person name from the URL path. */
export const NameParamSchema = z.string().trim().min(1).max(200);

/** Optional ?minScore= (KNOWS score threshold for "is an expert"). */
export const MinScoreQuerySchema = z.object({
  minScore: z.coerce.number().min(0).max(1000).optional(),
});

/** ?minScore= and ?graph= (apex, or a replay graph such as apex_replay) for the dashboard endpoints. */
export const DashboardQuerySchema = MinScoreQuerySchema.extend({
  graph: IngestGraphSchema.default('apex'),
});
