import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { findRepoRoot } from './repo-root';

/** yes/no flags: accepts yes/no, true/false, 1/0 in any case; empty means the default. */
function yesNoFlag(defaultValue: 'yes' | 'no') {
  return z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? defaultValue : value))
    .pipe(z.enum(['yes', 'no', 'true', 'false', '1', '0']))
    .transform((value) => ['yes', 'true', '1'].includes(value))
    .default(defaultValue === 'yes');
}

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

    // LLM provider switch: USE_OPENAI=yes uses OpenAI, anything else uses Gemini.
    // Keys are only checked when the LLM is first used, so the API starts without them.
    USE_OPENAI: yesNoFlag('no'),
    OPENAI_API_KEY: optionalText,
    OPENAI_MODEL: z.string().min(1).default('gpt-5-nano'),
    OPENAI_EMBED_MODEL: z.string().min(1).default('text-embedding-3-small'),
    // GPT-5 models bill hidden reasoning as output tokens; "minimal" is the cheapest.
    OPENAI_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('minimal'),
    // Reasoning effort for the question-answering agent (OpenAI only): picking tools needs a little more than extraction.
    AGENT_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),

    // Gemini (the default provider).
    GEMINI_API_KEYS: z
      .string()
      .default('')
      .transform((raw) => raw.split(',').map((key) => key.trim()).filter((key) => key.length > 0)),
    GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
    GEMINI_EMBED_MODEL: z.string().min(1).default('gemini-embedding-001'),
    // Interpolated into the vector index DDL (it cannot be a parameter), so it
    // must be a validated integer in a sane range.
    EMBED_DIM: z.coerce.number().int().min(1).max(4096).default(768),

    // LLM cache: every LLM output is cached under DATA_DIR/llm-cache. With
    // LLM_CACHE_ONLY=yes a cache miss is an error, which proves a rerun makes zero LLM calls.
    LLM_CACHE_ONLY: yesNoFlag('no'),
    // At most this many LLM requests in flight at once.
    LLM_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),

    // LLM extraction budget: refuse to start above this many planned calls (unless force).
    EXTRACT_MAX_CALLS: z.coerce.number().int().positive().default(4000),
    // Optional: only extract artifacts authored by these departments (comma separated).
    EXTRACT_DEPTS: z
      .string()
      .default('')
      .transform((raw) => raw.split(',').map((d) => d.trim()).filter((d) => d.length > 0)),

    // A System is "core" (bus factor, departure impact, apex_proj) when at least this many
    // artifacts mention it, written by at least 2 people. See catalog.constants.ts.
    CORE_MIN_MENTIONS: z.coerce.number().int().min(1).default(5),

    // At most this many what-if simulations (each a GRAPH.COPY of apex_proj) run at once.
    WHATIF_MAX_CONCURRENT: z.coerce.number().int().min(1).max(16).default(2),

    // Memory guard for ingestion stages; both below the container's 4 GB limit.
    MEMORY_WARN_MB: z.coerce.number().int().positive().default(3000),
    MEMORY_MAX_MB: z.coerce.number().int().positive().default(3600),

    // TextStore: where artifact bodies and chunk text live (never in the graph).
    TEXT_STORE: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: optionalText,
    DATA_DIR: z.string().min(1).default('./data'),

    // Ingestion. In development the API process also runs the BullMQ worker;
    // in production a separate `worker` container does (dist/worker.js).
    INGEST_WORKER_INLINE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // When set, POST /ingest/* requires the header `x-admin-token: <value>`.
    ADMIN_TOKEN: optionalText,

    // POST /agent/ask limits (it spends LLM calls): per visitor per minute, and for everyone per hour.
    AGENT_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(6),
    AGENT_RATE_PER_HOUR: z.coerce.number().int().min(1).default(300),

    // HTTP.
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
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
