import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { AnalyticsModule } from '../analytics/analytics.module';
import type { Env } from '../config/env.schema';
import { ProjectionModule } from '../projection/projection.module';
import { ActionsExportService } from './actions-export.service';
import { AdminController } from './admin.controller';
import { BACKUP_SETTINGS, type BackupSettings, EXPORT_STORE, GRAPH_LOCK_REDIS, MAINTENANCE_EVERY_MS } from './backup.constants';
import { BackupService } from './backup.service';
import { type ExportStore, exportStoreFor } from './export-store';
import { GraphLock } from './graph-lock';
import { MaintenanceJobs } from './maintenance.jobs';

/**
 * Backups (apex -> apex_backup), restore, the actions export and the graph lock.
 * The API serves /admin/*; the worker runs the 6-hourly jobs (MaintenanceJobs).
 */
@Module({
  imports: [AnalyticsModule, ProjectionModule],
  controllers: [AdminController],
  providers: [
    {
      provide: BACKUP_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): BackupSettings => ({
        redisUrl: config.get('REDIS_URL', { infer: true }),
        memoryMaxMb: config.get('MEMORY_MAX_MB', { infer: true }),
        everyMs: MAINTENANCE_EVERY_MS,
      }),
    },
    {
      // Its own connection: commands wait while Redis reconnects instead of failing at once.
      provide: GRAPH_LOCK_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const redis = new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: 3 });
        redis.on('error', () => undefined); // reported by /health and by the callers that fail
        return redis;
      },
    },
    {
      provide: EXPORT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ExportStore =>
        exportStoreFor({
          TEXT_STORE: config.get('TEXT_STORE', { infer: true }),
          S3_BUCKET: config.get('S3_BUCKET', { infer: true }),
          DATA_DIR: config.get('DATA_DIR', { infer: true }),
        }),
    },
    GraphLock,
    ActionsExportService,
    BackupService,
    MaintenanceJobs,
  ],
  exports: [GraphLock, ActionsExportService, BackupService, MaintenanceJobs],
})
export class BackupModule {}
