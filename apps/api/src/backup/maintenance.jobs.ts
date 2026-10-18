import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { closeWithin } from '../common/close-within';
import { bullConnection } from '../ingest/redis-connection';
import { ActionsExportService } from './actions-export.service';
import { MemoryExportService } from './memory-export.service';
import {
  BACKUP_JOB,
  BACKUP_SETTINGS,
  type BackupSettings,
  EXPORT_ACTIONS_JOB,
  KEEP_MAINTENANCE_JOBS,
  MAINTENANCE_QUEUE,
} from './backup.constants';
import { BackupService } from './backup.service';

/**
 * The worker's repeatable jobs: back up apex and export actions every 6 hours
 * (BullMQ job schedulers, stored in Redis, so a restart does not add duplicates).
 * Started only by worker.ts; concurrency 1, so the two jobs never overlap.
 */
@Injectable()
export class MaintenanceJobs implements OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceJobs.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly connections: Redis[] = [];

  constructor(
    private readonly backup: BackupService,
    private readonly actionsExport: ActionsExportService,
    @Inject(BACKUP_SETTINGS) private readonly settings: BackupSettings,
    /** The agent's memory is exported with the actions: both are made by people (Stage 16). */
    @Optional() private readonly memoryExport?: MemoryExportService,
  ) {}

  async start(): Promise<void> {
    if (this.worker) return;
    const queueConnection = bullConnection(this.settings.redisUrl);
    const workerConnection = bullConnection(this.settings.redisUrl);
    this.connections.push(queueConnection, workerConnection);
    for (const connection of this.connections) {
      connection.on('error', (error) => this.logger.warn(`BullMQ Redis error: ${error.message || error.name}`));
    }

    this.queue = new Queue(MAINTENANCE_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: { removeOnComplete: KEEP_MAINTENANCE_JOBS, removeOnFail: KEEP_MAINTENANCE_JOBS },
    });
    // upsert: creating the same scheduler again (every restart) only updates it.
    for (const name of [EXPORT_ACTIONS_JOB, BACKUP_JOB]) {
      await this.queue.upsertJobScheduler(name, { every: this.settings.everyMs }, { name, data: {} });
    }

    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.process(job), { connection: workerConnection, concurrency: 1 });
    this.worker.on('failed', (job, error) => this.logger.error(`Maintenance job ${job?.name} failed: ${error.message}`));
    this.logger.log(`Maintenance jobs scheduled every ${this.settings.everyMs / 3_600_000} h: ${EXPORT_ACTIONS_JOB}, ${BACKUP_JOB}`);
  }

  /** Runs one job; the result (done or skipped, with the reason) is kept in Redis by BullMQ. */
  async process(job: Job): Promise<object> {
    if (job.name === BACKUP_JOB) return this.backup.backupNow();
    if (job.name === EXPORT_ACTIONS_JOB) {
      const actions = await this.actionsExport.exportNow();
      return this.memoryExport ? { ...actions, memory: await this.memoryExport.exportNow() } : actions;
    }
    throw new Error(`Unknown maintenance job "${job.name}"`);
  }

  async onModuleDestroy(): Promise<void> {
    const { worker, queue } = this;
    this.worker = null;
    this.queue = null;
    if (worker) await closeWithin('maintenance worker', this.logger, () => worker.close());
    if (queue) await closeWithin('maintenance queue', this.logger, () => queue.close());
    for (const connection of this.connections) connection.disconnect();
  }
}
