import { Module } from '@nestjs/common';
import { BackupModule } from './backup/backup.module';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { TextStoreModule } from './ingest/text-store.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';

/**
 * Everything the standalone worker needs: config, FalkorDB, LLM, ingest and extract
 * jobs, and the 6-hourly backup and actions export (BackupModule). No HTTP.
 */
@Module({
  imports: [AppConfigModule, GraphModule, LlmModule, TextStoreModule, JobsModule, BackupModule],
})
export class WorkerModule {}
