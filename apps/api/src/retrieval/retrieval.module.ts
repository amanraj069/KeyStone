import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { RETRIEVAL_SETTINGS, type RetrievalSettings, RetrievalService } from './retrieval.service';
import { SearchController } from './search.controller';

/** Chunking, embeddings and search (Stage 6). */
@Module({
  controllers: [SearchController],
  providers: [
    {
      provide: RETRIEVAL_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RetrievalSettings => ({
        embedDim: config.get('EMBED_DIM', { infer: true }),
        memoryWarnMb: config.get('MEMORY_WARN_MB', { infer: true }),
        embedModel: embedModelName({
          useOpenai: config.get('USE_OPENAI', { infer: true }),
          openai: config.get('OPENAI_EMBED_MODEL', { infer: true }),
          gemini: config.get('GEMINI_EMBED_MODEL', { infer: true }),
        }),
      }),
    },
    RetrievalService,
  ],
  exports: [RetrievalService],
})
export class RetrievalModule {}

/** "openai/text-embedding-3-small" or "gemini/gemini-embedding-001": stored on every Chunk. */
export function embedModelName(input: { useOpenai: boolean; openai: string; gemini: string }): string {
  return input.useOpenai ? `openai/${input.openai}` : `gemini/${input.gemini}`;
}
