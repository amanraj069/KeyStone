import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IngestWorker } from './ingest/ingest.worker';
import { WorkerModule } from './worker.module';

/**
 * Standalone ingest worker (production: the `worker` container runs
 * `node dist/worker.js`). Set INGEST_WORKER_INLINE=false on the API so jobs
 * are only processed here.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  app.get(IngestWorker).start();
  new Logger('Worker').log('Keystone ingest worker started');
}

void bootstrap();
