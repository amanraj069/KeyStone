import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ExtractRequestSchema,
  FullIngestRequestSchema,
  RefreshExpertiseRequestSchema,
  ReplayRequestSchema,
} from '@keystone/shared';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { projectionGraphFor } from '../analytics/analytics.constants';
import { ExpertiseService } from '../analytics/expertise.service';
import { ExtractService } from '../extract/extract.service';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { ProjectionService } from '../projection/projection.service';
import { GRAPH_COUNTS } from './queries/ingest.queries';
import { EXTRACT_JOB, FULL_JOB, INGEST_SETTINGS, type IngestSettings, REFRESH_EXPERTISE_JOB, REPLAY_JOB } from './ingest.constants';
import { IngestService } from './ingest.service';
import { closeWithin } from '../common/close-within';
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
    private readonly expertise: ExpertiseService,
    private readonly projection: ProjectionService,
    private readonly graph: GraphService,
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
      // After every replayed day: copy that day's extraction from apex, refresh expertise as of that day.
      return this.ingest.runReplay(request.graph, request, report, undefined, (day) => this.afterReplayDay(request.graph, day));
    }
    if (job.name === EXTRACT_JOB) {
      const request = ExtractRequestSchema.parse(job.data);
      const summary = await this.extract.run(request, report);
      // The job result is stored in Redis, so keep it small.
      return { selected: summary.selected, llmCalls: summary.llmCalls + summary.linkCalls, failures: summary.failures.length };
    }
    if (job.name === REFRESH_EXPERTISE_JOB) {
      const request = RefreshExpertiseRequestSchema.parse(job.data);
      return this.refreshExpertise(request.graph, request.asOfDay, report);
    }
    throw new Error(`Unknown job "${job.name}"`);
  }

  /** refresh-expertise job: K2 + K8a on a graph, then rebuild its projection, with progress events. */
  private async refreshExpertise(
    graphName: string,
    asOfDay: number | undefined,
    report: (progress: object) => Promise<unknown>,
  ): Promise<object> {
    const send = async (phase: string, percent: number, added: Record<string, number>, message: string) => {
      const [totals] = await this.graph.roQuery<{ people: number; artifacts: number; edges: number }>(graphName, GRAPH_COUNTS);
      await report({ kind: 'refresh-expertise', graph: graphName, phase, percent, day: asOfDay ?? null, added, totals, message });
    };
    await send('start', 5, {}, 'Recomputing KNOWS and COLLAB');
    const { refreshed, projected } = await this.refreshAndProject(graphName, asOfDay);
    await send('done', 100, { knows: refreshed.knows, collab: refreshed.collab, projectedPeople: projected.people },
      `KNOWS ${refreshed.knows}, COLLAB ${refreshed.collab} as of day ${refreshed.asOfDay}; ${projected.targetGraph} rebuilt`);
    return { asOfDay: refreshed.asOfDay, knows: refreshed.knows, collab: refreshed.collab, projection: projected };
  }

  /**
   * After one replayed day. Runs the refresh-expertise steps inline rather than
   * queueing that job: the single worker is busy with this replay, so a queued
   * job would only start once every day had been replayed.
   */
  private async afterReplayDay(graphName: string, day: number): Promise<Record<string, number>> {
    const copied = await this.extract.replayDay(APEX_GRAPH, graphName, day);
    const { refreshed } = await this.refreshAndProject(graphName, day);
    return { mentions: copied.mentions, decisions: copied.decisions, knows: refreshed.knows, collab: refreshed.collab };
  }

  /** The refresh-expertise steps: KNOWS and COLLAB as of a day, then the graph's projection. */
  private async refreshAndProject(graphName: string, asOfDay: number | undefined) {
    const refreshed = await this.expertise.refresh({ graph: graphName, asOfDay });
    const projected = await this.projection.rebuild(projectionGraphFor(graphName), { sourceGraph: graphName });
    return { refreshed, projected };
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    // force: do not wait for a running job to finish; BullMQ will retry it later.
    if (worker) await closeWithin('BullMQ worker', this.logger, () => worker.close(true));
    this.connection?.disconnect();
  }
}
