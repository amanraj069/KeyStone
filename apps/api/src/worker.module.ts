import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { TextStoreModule } from './ingest/text-store.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';

/** Everything the standalone worker needs: config, FalkorDB, LLM, ingest and extract jobs. No HTTP. */
@Module({
  imports: [AppConfigModule, GraphModule, LlmModule, TextStoreModule, JobsModule],
})
export class WorkerModule {}
