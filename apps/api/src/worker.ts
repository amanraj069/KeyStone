import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MaintenanceJobs } from './backup/maintenance.jobs';
import { IngestWorker } from './ingest/ingest.worker';
import { WorkerModule } from './worker.module';

/**
 * Standalone worker (production: the `worker` container runs `node dist/worker.js`):
 * the BullMQ ingest worker, plus the backup and actions-export jobs every 6 hours.
 * Set INGEST_WORKER_INLINE=false on the API so ingest jobs are only processed here.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  app.get(IngestWorker).start();
  await app.get(MaintenanceJobs).start();
  new Logger('Worker').log('Keystone worker started (ingest jobs, backups, actions export)');
}

void bootstrap();
