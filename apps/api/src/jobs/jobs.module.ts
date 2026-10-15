import { Module } from '@nestjs/common';
import { ExtractController } from '../extract/extract.controller';
import { ExtractModule } from '../extract/extract.module';
import { IngestController } from '../ingest/ingest.controller';
import { IngestModule } from '../ingest/ingest.module';
import { IngestQueue } from '../ingest/ingest.queue';
import { IngestWorker } from '../ingest/ingest.worker';

/**
 * Background jobs: one BullMQ queue and one worker (concurrency 1) run ingest
 * and extract jobs, so they never write the graph at the same time.
 */
@Module({
  imports: [IngestModule, ExtractModule],
  controllers: [IngestController, ExtractController],
  providers: [IngestQueue, IngestWorker],
  exports: [IngestQueue, IngestWorker],
})
export class JobsModule {}
