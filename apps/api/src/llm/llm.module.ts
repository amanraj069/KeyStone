import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { llmSettingsFromEnv } from './llm-settings';
import { LLM_SETTINGS, type LlmSettings } from './llm.types';
import { LlmService } from './llm.service';

/** Provides LlmService (OpenAI or Gemini, cached, Zod-validated) to the whole app. */
@Global()
@Module({
  providers: [
    {
      provide: LLM_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmSettings =>
        llmSettingsFromEnv({
          USE_OPENAI: config.get('USE_OPENAI', { infer: true }),
          OPENAI_API_KEY: config.get('OPENAI_API_KEY', { infer: true }),
          OPENAI_MODEL: config.get('OPENAI_MODEL', { infer: true }),
          OPENAI_EMBED_MODEL: config.get('OPENAI_EMBED_MODEL', { infer: true }),
          OPENAI_REASONING_EFFORT: config.get('OPENAI_REASONING_EFFORT', { infer: true }),
          GEMINI_API_KEYS: config.get('GEMINI_API_KEYS', { infer: true }),
          GEMINI_MODEL: config.get('GEMINI_MODEL', { infer: true }),
          GEMINI_EMBED_MODEL: config.get('GEMINI_EMBED_MODEL', { infer: true }),
          EMBED_DIM: config.get('EMBED_DIM', { infer: true }),
          DATA_DIR: config.get('DATA_DIR', { infer: true }),
          LLM_CACHE_ONLY: config.get('LLM_CACHE_ONLY', { infer: true }),
          LLM_CONCURRENCY: config.get('LLM_CONCURRENCY', { infer: true }),
        }),
    },
    LlmService,
  ],
  exports: [LlmService, LLM_SETTINGS],
})
export class LlmModule {}
