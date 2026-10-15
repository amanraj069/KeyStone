import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { findRepoRoot } from './repo-root';

/** `KEY=` in a .env file gives an empty string; treat that as "not set". */
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/**
 * Every environment variable the API reads, validated once at startup.
 * Keep this in sync with .env.example.
 */
export const EnvSchema = z
  .object({
    // FalkorDB (local Docker container).
    FALKOR_HOST: z.string().min(1).default('localhost'),
    FALKOR_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    FALKOR_PASSWORD: z.string().min(1, 'FALKOR_PASSWORD is required'),

    // Separate Redis used only by BullMQ.
    REDIS_URL: z.url().default('redis://localhost:6380'),

    // Gemini. Keys are optional until the stages that call the LLM.
    GEMINI_API_KEYS: z
      .string()
      .default('')
      .transform((raw) => raw.split(',').map((key) => key.trim()).filter((key) => key.length > 0)),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    GEMINI_EMBED_MODEL: z.string().min(1).default('gemini-embedding-001'),
    // Interpolated into the vector index DDL (it cannot be a parameter), so it
    // must be a validated integer in a sane range.
    EMBED_DIM: z.coerce.number().int().min(1).max(4096).default(768),

    // Memory guard for ingestion stages; both below the container's 4 GB limit.
    MEMORY_WARN_MB: z.coerce.number().int().positive().default(3000),
    MEMORY_MAX_MB: z.coerce.number().int().positive().default(3600),

    // TextStore: where artifact bodies and chunk text live (never in the graph).
    TEXT_STORE: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: optionalText,
    DATA_DIR: z.string().min(1).default('./data'),

    // HTTP.
    WEB_ORIGIN: z.url().default('http://localhost:3001'),
    API_BASE_URL: z.url().default('http://localhost:4000'),
  })
  .refine((env) => env.MEMORY_WARN_MB < env.MEMORY_MAX_MB, {
    message: 'MEMORY_WARN_MB must be lower than MEMORY_MAX_MB',
    path: ['MEMORY_WARN_MB'],
  })
  .refine((env) => env.TEXT_STORE !== 's3' || env.S3_BUCKET !== undefined, {
    message: 'S3_BUCKET is required when TEXT_STORE=s3',
    path: ['S3_BUCKET'],
  })
  // A relative DATA_DIR is relative to the repo root, not to whichever folder you ran from.
  .transform((env) => ({
    ...env,
    DATA_DIR: isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(findRepoRoot(), env.DATA_DIR),
  }));

export type Env = z.output<typeof EnvSchema>;

/**
 * Validates raw environment variables. Throws one readable error listing every
 * problem. Only variable names and Zod messages are printed, never the values,
 * so a bad password can never end up in a log.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
