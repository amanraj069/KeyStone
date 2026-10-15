import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { INGEST_QUEUE, INGEST_SETTINGS, type IngestSettings } from './ingest.constants';
import { IngestService } from './ingest.service';

/** Deterministic ingestion (no LLM). The queue, worker and HTTP endpoints live in JobsModule. */
@Module({
  providers: [
    {
      provide: INGEST_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): IngestSettings => ({
        dataDir: config.get('DATA_DIR', { infer: true }),
        redisUrl: config.get('REDIS_URL', { infer: true }),
        queueName: INGEST_QUEUE,
        workerInline: config.get('INGEST_WORKER_INLINE', { infer: true }),
      }),
    },
    IngestService,
  ],
  exports: [IngestService, INGEST_SETTINGS],
})
export class IngestModule {}
