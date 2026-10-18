import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BackupModule } from '../backup/backup.module';
import type { Env } from '../config/env.schema';
import { IngestModule } from '../ingest/ingest.module';
import { ProjectionModule } from '../projection/projection.module';
import { embedModelName } from '../retrieval/retrieval.module';
import { SEED_SETTINGS, type SeedSettings } from './seed.constants';
import { SeedService } from './seed.service';

/** The seed command (rebuild apex from files, no LLM calls) and the API's startup graph check. */
@Module({
  imports: [IngestModule, AnalyticsModule, ProjectionModule, BackupModule],
  providers: [
    {
      provide: SEED_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SeedSettings => ({
        dataDir: config.get('DATA_DIR', { infer: true }),
        s3Bucket: config.get('S3_BUCKET', { infer: true }),
        embedDim: config.get('EMBED_DIM', { infer: true }),
        memoryWarnMb: config.get('MEMORY_WARN_MB', { infer: true }),
        embedModel: embedModelName({
          useOpenai: config.get('USE_OPENAI', { infer: true }),
          openai: config.get('OPENAI_EMBED_MODEL', { infer: true }),
          gemini: config.get('GEMINI_EMBED_MODEL', { infer: true }),
        }),
        extractDepts: config.get('EXTRACT_DEPTS', { infer: true }),
        extractMaxCalls: config.get('EXTRACT_MAX_CALLS', { infer: true }),
      }),
    },
    SeedService,
  ],
  exports: [SeedService],
})
export class SeedModule {}
