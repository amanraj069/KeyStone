import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ExtractRequestSchema, FullIngestRequestSchema, ReplayRequestSchema } from '@keystone/shared';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { ExtractService } from '../extract/extract.service';
import { EXTRACT_JOB, FULL_JOB, INGEST_SETTINGS, type IngestSettings, REPLAY_JOB } from './ingest.constants';
import { IngestService } from './ingest.service';
import { bullConnection } from './redis-connection';

/**
 * The consumer side: a BullMQ worker that runs ingest and extract jobs one at a time
 * (concurrency 1, so two jobs never write the same graph at once).
 * Started inside the API when INGEST_WORKER_INLINE=true, otherwise by worker.ts.
 */
@Injectable()
export class IngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestWorker.name);
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly ingest: IngestService,
    private readonly extract: ExtractService,
    @Inject(INGEST_SETTINGS) private readonly settings: IngestSettings,
  ) {}

  onModuleInit(): void {
    if (this.settings.workerInline) this.start();
  }

  start(): void {
    if (this.worker) return;
    this.connection = bullConnection(this.settings.redisUrl);
    this.connection.on('error', (error) => this.logger.warn(`BullMQ Redis error: ${error.message || error.name}`));
    this.worker = new Worker(this.settings.queueName, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => this.logger.error(`Ingest job ${job?.id} failed: ${error.message}`));
    this.logger.log(`Ingest worker listening on queue "${this.settings.queueName}"`);
  }

  /** Validates the job data again (it crossed Redis) and runs the matching ingest. */
  async process(job: Job): Promise<object> {
    const report = (progress: object) => job.updateProgress(progress);
    if (job.name === FULL_JOB) {
      const request = FullIngestRequestSchema.parse(job.data);
      return this.ingest.runFull(request.graph, report);
    }
    if (job.name === REPLAY_JOB) {
      const request = ReplayRequestSchema.parse(job.data);
      return this.ingest.runReplay(request.graph, request, report);
    }
    if (job.name === EXTRACT_JOB) {
      const request = ExtractRequestSchema.parse(job.data);
      const summary = await this.extract.run(request, report);
      // The job result is stored in Redis, so keep it small.
      return { selected: summary.selected, llmCalls: summary.llmCalls + summary.linkCalls, failures: summary.failures.length };
    }
    throw new Error(`Unknown job "${job.name}"`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
    this.worker = null;
  }
}
