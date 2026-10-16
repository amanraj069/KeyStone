import { randomBytes } from 'node:crypto';
import type { IngestEvent, IngestProgress } from '@keystone/shared';
import { firstValueFrom, toArray } from 'rxjs';
import { validateEnv } from '../src/config/env.schema';
import type { IngestSettings } from '../src/ingest/ingest.constants';
import { IngestQueue } from '../src/ingest/ingest.queue';
import type { ExtractService } from '../src/extract/extract.service';
import type { IngestService } from '../src/ingest/ingest.service';
import { IngestWorker } from '../src/ingest/ingest.worker';

/**
 * End-to-end through real Redis (BullMQ): POST-equivalent -> queue -> worker ->
 * progress events -> SSE stream. IngestService is faked, so no graph is written,
 * and the queue name is unique, so a running dev worker never takes these jobs.
 */
describe('ingest queue, worker and progress stream', () => {
  const settings: IngestSettings = {
    dataDir: 'unused',
    redisUrl: validateEnv(process.env).REDIS_URL,
    queueName: `test_ingest_${randomBytes(4).toString('hex')}`,
    workerInline: false,
  };

  const progress = (day: number): IngestProgress => ({
    kind: 'replay',
    graph: 'apex_replay',
    phase: 'day',
    percent: day * 50,
    day,
    added: { artifacts: day },
    totals: { people: day, artifacts: day, edges: day },
    message: `Day ${day}`,
  });

  const fakeIngest = {
    runReplay: jest.fn(async (_graph: string, _request: unknown, report: (p: IngestProgress) => Promise<void>) => {
      for (const day of [1, 2]) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await report(progress(day));
      }
      return { people: 2, artifacts: 2, edges: 2 };
    }),
  } as unknown as IngestService;

  const queue = new IngestQueue(settings);
  // Only the replay path is exercised; the other services are never called.
  const unused = {} as never;
  const worker = new IngestWorker(fakeIngest, {} as unknown as ExtractService, unused, unused, unused, settings);

  beforeAll(() => worker.start());
  afterAll(async () => {
    await worker.onModuleDestroy();
    await queue.queue.obliterate({ force: true });
    await queue.onModuleDestroy();
  });

  it('streams each progress event and then "completed"', async () => {
    const job = await queue.addReplay({ graph: 'apex_replay', fromDay: 1, toDay: 2, delayMs: 0, reset: true });
    const events: IngestEvent[] = await firstValueFrom(queue.events$(job.jobId).pipe(toArray()));

    expect(events.filter((e) => e.type === 'progress').map((e) => (e.type === 'progress' ? e.progress.day : null))).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(events.at(-1)).toEqual({ type: 'completed', jobId: job.jobId });
    await expect(queue.getJob(job.jobId)).resolves.toMatchObject({ state: 'completed', progress: progress(2) });
  });

  it('getJob 404s for an unknown id', async () => {
    await expect(queue.getJob('does-not-exist')).rejects.toThrow(/No ingest job/);
  });
});
