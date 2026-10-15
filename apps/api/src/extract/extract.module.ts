import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { ExtractCacheService } from './extract-cache.service';
import { EXTRACT_CACHE, EXTRACT_SETTINGS, type ExtractSettings } from './extract.constants';
import { ExtractService } from './extract.service';

/** Bodies shorter than this are not worth an LLM call (too little text to hold a decision). */
const MIN_BODY_CHARS = 300;

/** LLM extraction of systems and decisions. Runs as a BullMQ job (JobsModule) or from the CLI. */
@Module({
  providers: [
    {
      provide: EXTRACT_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ExtractSettings => ({
        dataDir: config.get('DATA_DIR', { infer: true }),
        minBodyChars: MIN_BODY_CHARS,
        maxCalls: config.get('EXTRACT_MAX_CALLS', { infer: true }),
        depts: config.get('EXTRACT_DEPTS', { infer: true }),
      }),
    },
    {
      provide: EXTRACT_CACHE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new ExtractCacheService(config.get('DATA_DIR', { infer: true }), config.get('S3_BUCKET', { infer: true })),
    },
    ExtractService,
  ],
  exports: [ExtractService],
})
export class ExtractModule {}
