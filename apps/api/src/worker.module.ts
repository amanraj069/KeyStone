import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { IngestModule } from './ingest/ingest.module';
import { LlmModule } from './llm/llm.module';

/** Everything the standalone ingest worker needs: config, FalkorDB, ingestion. No HTTP. */
@Module({
  imports: [AppConfigModule, GraphModule, IngestModule, LlmModule],
})
export class WorkerModule {}
