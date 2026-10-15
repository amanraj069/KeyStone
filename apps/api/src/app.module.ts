import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
import { TextStoreModule } from './ingest/text-store.module';
import { JobsModule } from './jobs/jobs.module';
import { LlmModule } from './llm/llm.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AppConfigModule, GraphModule, RedisModule, HealthModule, LlmModule, TextStoreModule, JobsModule, RetrievalModule],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
