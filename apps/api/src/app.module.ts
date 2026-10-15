import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { join } from 'node:path';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { validateEnv } from './config/env.schema';
import { findRepoRoot } from './config/repo-root';
import { GraphModule } from './graph/graph.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repo root, shared with docker compose.
      // Real environment variables win over the file (useful in production).
      envFilePath: join(findRepoRoot(), '.env'),
      validate: validateEnv,
    }),
    GraphModule,
    RedisModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
