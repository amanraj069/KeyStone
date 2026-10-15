import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import {
  type ExtractRequest,
  type FullIngestRequest,
  type IngestEvent,
  type IngestJob,
  IngestProgressSchema,
  type ReplayRequest,
} from '@keystone/shared';
import { type Job, Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { EXTRACT_JOB, FULL_JOB, INGEST_SETTINGS, type IngestSettings, KEEP_FINISHED_JOBS, REPLAY_JOB } from './ingest.constants';
import { bullConnection } from './redis-connection';

/**
 * The producer side of ingestion: adds jobs to the BullMQ queue and turns
 * BullMQ's progress events into a stream the API serves over SSE.
 */
@Injectable()
export class IngestQueue implements OnModuleDestroy {
  private readonly logger = new Logger(IngestQueue.name);
  private readonly connections: Redis[];
  readonly queue: Queue;
  private readonly events: QueueEvents;

  constructor(@Inject(INGEST_SETTINGS) settings: IngestSettings) {
    const queueConnection = bullConnection(settings.redisUrl);
    const eventsConnection = bullConnection(settings.redisUrl);
    this.connections = [queueConnection, eventsConnection];
    for (const connection of this.connections) {
      connection.on('error', (error) => this.logger.warn(`BullMQ Redis error: ${error.message || error.name}`));
    }
    this.queue = new Queue(settings.queueName, {
      connection: queueConnection,
      defaultJobOptions: { removeOnComplete: KEEP_FINISHED_JOBS, removeOnFail: KEEP_FINISHED_JOBS },
    });
    this.events = new QueueEvents(settings.queueName, { connection: eventsConnection });
    // Many SSE clients may listen at once.
    this.events.setMaxListeners(100);
  }

  async addFull(request: FullIngestRequest): Promise<IngestJob> {
    return this.describe(await this.queue.add(FULL_JOB, request));
  }

  async addReplay(request: ReplayRequest): Promise<IngestJob> {
    return this.describe(await this.queue.add(REPLAY_JOB, request));
  }

  async addExtract(request: ExtractRequest): Promise<IngestJob> {
    return this.describe(await this.queue.add(EXTRACT_JOB, request));
  }

  async getJob(jobId: string): Promise<IngestJob> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`No ingest job ${jobId}`);
    return this.describe(job);
  }

  /**
   * Live events for one job: its current progress first, then every progress
   * update, ending with "completed" or "failed". Listeners are registered before
   * the current state is read, so an event can never slip through the gap.
   */
  events$(jobId: string): Observable<IngestEvent> {
    return new Observable<IngestEvent>((subscriber) => {
      const onProgress = ({ jobId: id, data }: { jobId: string; data: unknown }) => {
        const progress = IngestProgressSchema.safeParse(data);
        if (id === jobId && progress.success) subscriber.next({ type: 'progress', jobId, progress: progress.data });
      };
      const onCompleted = ({ jobId: id }: { jobId: string }) => {
        if (id !== jobId) return;
        subscriber.next({ type: 'completed', jobId });
        subscriber.complete();
      };
      const onFailed = ({ jobId: id, failedReason }: { jobId: string; failedReason: string }) => {
        if (id !== jobId) return;
        subscriber.next({ type: 'failed', jobId, reason: failedReason });
        subscriber.complete();
      };
      this.events.on('progress', onProgress);
      this.events.on('completed', onCompleted);
      this.events.on('failed', onFailed);

      void this.getJob(jobId)
        .then((job) => {
          if (job.progress) subscriber.next({ type: 'progress', jobId, progress: job.progress });
          if (job.state === 'completed') onCompleted({ jobId });
          if (job.state === 'failed') onFailed({ jobId, failedReason: job.failedReason ?? 'unknown' });
        })
        .catch((error: unknown) => subscriber.error(error));

      return () => {
        this.events.off('progress', onProgress);
        this.events.off('completed', onCompleted);
        this.events.off('failed', onFailed);
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events.close();
    await this.queue.close();
    for (const connection of this.connections) connection.disconnect();
  }

  private async describe(job: Job): Promise<IngestJob> {
    const progress = IngestProgressSchema.safeParse(job.progress);
    return {
      jobId: String(job.id),
      name: job.name === REPLAY_JOB ? 'replay' : job.name === EXTRACT_JOB ? 'extract' : 'full',
      state: await job.getState(),
      progress: progress.success ? progress.data : null,
      failedReason: job.failedReason ?? null,
    };
  }
}
