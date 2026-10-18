import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BackupModule } from '../backup/backup.module';
import { ExtractModule } from '../extract/extract.module';
import { IngestModule } from '../ingest/ingest.module';
import { ProjectionModule } from '../projection/projection.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

/** Live documents: post a company document now and see the knowledge graph change (Stage 17). */
@Module({
  imports: [IngestModule, ExtractModule, RetrievalModule, AnalyticsModule, ProjectionModule, BackupModule, ActionsModule],
  controllers: [LiveController],
  providers: [LiveService],
})
export class LiveModule {}
