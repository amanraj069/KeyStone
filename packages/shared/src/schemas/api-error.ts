import { z } from 'zod';

/**
 * The single error shape every API endpoint returns.
 * The API's global exception filter produces it; the web app parses it.
 */
export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  // Short machine-readable code, e.g. "NOT_FOUND" or "VALIDATION_FAILED".
  error: z.string(),
  message: z.string(),
  // Optional extra detail, e.g. Zod issues. Never contains secrets.
  details: z.unknown().optional(),
  path: z.string(),
  timestamp: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
