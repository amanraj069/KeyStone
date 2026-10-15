import { join } from 'node:path';
import type { Env } from '../config/env.schema';
import type { LlmSettings } from './llm.types';

/** The env fields the LLM layer reads. */
export type LlmEnv = Pick<
  Env,
  | 'USE_OPENAI'
  | 'OPENAI_API_KEY'
  | 'OPENAI_MODEL'
  | 'OPENAI_EMBED_MODEL'
  | 'OPENAI_REASONING_EFFORT'
  | 'GEMINI_API_KEYS'
  | 'GEMINI_MODEL'
  | 'GEMINI_EMBED_MODEL'
  | 'EMBED_DIM'
  | 'DATA_DIR'
  | 'LLM_CACHE_ONLY'
  | 'LLM_CONCURRENCY'
>;

/** LlmSettings from validated env. Used by LlmModule and by scripts. */
export function llmSettingsFromEnv(env: LlmEnv): LlmSettings {
  return {
    provider: env.USE_OPENAI ? 'openai' : 'gemini',
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      embedModel: env.OPENAI_EMBED_MODEL,
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
    },
    gemini: { apiKeys: env.GEMINI_API_KEYS, model: env.GEMINI_MODEL, embedModel: env.GEMINI_EMBED_MODEL },
    embedDim: env.EMBED_DIM,
    cacheDir: join(env.DATA_DIR, 'llm-cache'),
    cacheOnly: env.LLM_CACHE_ONLY,
    concurrency: env.LLM_CONCURRENCY,
  };
}
