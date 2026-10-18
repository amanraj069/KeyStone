import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
import { TextStoreModule } from './ingest/text-store.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ActionsModule } from './actions/actions.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AgentModule } from './agent/agent.module';
import { BenchModule } from './bench/bench.module';
import { McpModule } from './mcp/mcp.module';
import { LiveModule } from './live/live.module';
import { MemoryModule } from './memory/memory.module';
import { WhatIfModule } from './whatif/whatif.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { RedisModule } from './redis/redis.module';
import { BackupModule } from './backup/backup.module';
import { SeedModule } from './seed/seed.module';

@Module({
  imports: [AppConfigModule, GraphModule, RedisModule, HealthModule, LlmModule, TextStoreModule, JobsModule, RetrievalModule, AnalyticsModule, WhatIfModule, McpModule, AgentModule, MemoryModule, LiveModule, ActionsModule, ArtifactsModule, BenchModule, BackupModule, SeedModule],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
