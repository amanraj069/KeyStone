import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RefreshController } from '../analytics/refresh.controller';
import { ExtractController } from '../extract/extract.controller';
import { ExtractModule } from '../extract/extract.module';
import { IngestController } from '../ingest/ingest.controller';
import { IngestModule } from '../ingest/ingest.module';
import { IngestQueue } from '../ingest/ingest.queue';
import { IngestWorker } from '../ingest/ingest.worker';
import { ProjectionModule } from '../projection/projection.module';

/**
 * Background jobs: one BullMQ queue and one worker (concurrency 1) run ingest,
 * extract and refresh-expertise jobs, so they never write the graph at the same time.
 */
@Module({
  imports: [IngestModule, ExtractModule, AnalyticsModule, ProjectionModule],
  controllers: [IngestController, ExtractController, RefreshController],
  providers: [IngestQueue, IngestWorker],
  exports: [IngestQueue, IngestWorker],
})
export class JobsModule {}
