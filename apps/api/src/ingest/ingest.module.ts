import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { INGEST_QUEUE, INGEST_SETTINGS, type IngestSettings, TEXT_STORE } from './ingest.constants';
import { IngestController } from './ingest.controller';
import { IngestQueue } from './ingest.queue';
import { IngestService } from './ingest.service';
import { IngestWorker } from './ingest.worker';
import { LocalTextStore, type TextStore } from './text-store';

@Module({
  controllers: [IngestController],
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
    {
      provide: TEXT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TextStore => {
        if (config.get('TEXT_STORE', { infer: true }) === 's3') {
          throw new Error('TEXT_STORE=s3 is not implemented yet; use TEXT_STORE=local');
        }
        return new LocalTextStore(config.get('DATA_DIR', { infer: true }));
      },
    },
    IngestService,
    IngestQueue,
    IngestWorker,
  ],
  exports: [IngestService, IngestWorker, TEXT_STORE],
})
export class IngestModule {}
