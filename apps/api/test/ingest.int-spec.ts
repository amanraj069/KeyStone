import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IngestProgress } from '@keystone/shared';
import type { GraphService } from '../src/graph/graph.service';
import { SchemaService } from '../src/graph/schema.service';
import { INGEST_QUEUE } from '../src/ingest/ingest.constants';
import { IngestService } from '../src/ingest/ingest.service';
import { LocalTextStore } from '../src/ingest/text-store';
import { connectTestGraphService, testGraphName } from './graph-test-utils';
import { MINI_RECORDS, record } from './ingest-records';
import { ARTIFACT_LINKS, BO_ACTIVITY, BO_ON_DAY_9_THREAD, DEPARTURES, PEOPLE_SUMMARY, PEOPLE_TO_TICKETS_PAGES_THREADS } from './queries/test.queries';
import { calendarFrom } from '../src/ingest/calendar';
import { buildPlan } from '../src/ingest/ingest-plan';
import { UPDATE_PERSON_ACTIVITY } from '../src/ingest/queries/ingest.queries';

describe('IngestService against a real FalkorDB', () => {
  let graph: GraphService;
  let service: IngestService;
  let dataDir: string;
  const fullGraph = testGraphName();
  const replayGraph = testGraphName();

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'keystone-ingest-'));
    await writeFile(join(dataDir, 'artifacts.jsonl'), MINI_RECORDS.map((r) => JSON.stringify(r)).join('\n') + '\n');
    graph = await connectTestGraphService();
    service = new IngestService(graph, new SchemaService(graph, 768), new LocalTextStore(dataDir), {
      dataDir,
      redisUrl: 'unused',
      queueName: INGEST_QUEUE,
      workerInline: false,
    });
  });

  afterAll(async () => {
    for (const name of [fullGraph, replayGraph]) await graph.deleteGraph(name).catch(() => undefined);
    await graph.onModuleDestroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('a full ingest builds people, artifacts and edges, and reports progress', async () => {
    const events: IngestProgress[] = [];
    const totals = await service.runFull(fullGraph, async (p) => void events.push(p));

    expect(totals).toEqual({ people: 3, artifacts: 12, edges: expect.any(Number) });
    expect(events.map((e) => e.phase)).toEqual(['reset', 'people', 'artifacts', 'roles', 'links', 'done']);
    expect(events.at(-1)!.percent).toBe(100);
  });

  it('connects people to tickets, pages and threads (what FalkorDB Browser shows)', async () => {
    const rows = await graph.roQuery<{ person: string; rel: string; artifact: string }>(fullGraph, PEOPLE_TO_TICKETS_PAGES_THREADS);
    expect(rows.map((r) => `${r.person} ${r.rel} ${r.artifact}`)).toEqual([
      'Ada AUTHORED CONF-1',
      'Ada ASSIGNED ENG-1',
      // A two-person thread: both PARTICIPATED; single-writer threads are AUTHORED.
      'Bo PARTICIPATED slack_product_2026-01-02T09:00:00',
      'Cy PARTICIPATED slack_product_2026-01-02T09:00:00',
      'Cy AUTHORED slack_product_2026-01-05T09:00:00',
      'Cy AUTHORED slack_product_2026-01-06T09:00:00',
    ]);
  });

  it('creates REFERENCES and FIXES links between artifacts', async () => {
    const rows = await graph.roQuery<{ from: string; rel: string; kind: string | null; to: string }>(fullGraph, ARTIFACT_LINKS);
    expect(rows).toEqual([
      { from: 'CONF-1', rel: 'REFERENCES', kind: 'jira', to: 'ENG-1' },
      { from: 'PR-1', rel: 'FIXES', kind: null, to: 'ENG-1' },
      { from: 'email_in', rel: 'REFERENCES', kind: 'causal_chain', to: 'ENG-1' },
    ]);
  });

  it('sets departments and activity days on people', async () => {
    const rows = await graph.roQuery(fullGraph, PEOPLE_SUMMARY);
    expect(rows).toEqual([
      { name: 'Ada', dept: 'Engineering_Backend', firstDay: 1, lastSeenDay: 4, active: true },
      { name: 'Bo', dept: 'Product', firstDay: 1, lastSeenDay: 3, active: true },
      { name: 'Cy', dept: 'Product', firstDay: 2, lastSeenDay: 4, active: true },
    ]);
  });

  it('is idempotent: a second full ingest gives the same totals', async () => {
    const first = await service.counts(fullGraph);
    await service.runFull(fullGraph, async () => undefined);
    await expect(service.counts(fullGraph)).resolves.toEqual(first);
  });

  it('a replay adds the company day by day, and the graph grows each day', async () => {
    const events: IngestProgress[] = [];
    await service.runReplay(replayGraph, { fromDay: 1, toDay: 3, delayMs: 0, reset: true }, async (p) => void events.push(p));

    const days = events.filter((e) => e.phase === 'day');
    expect(days.map((e) => e.day)).toEqual([1, 2, 3]);
    expect(days.map((e) => e.totals.artifacts)).toEqual([3, 6, 9]);
    expect(days[0].totals.people).toBe(2); // Ada and Bo on day 1; Cy first speaks on day 2
    expect(days[1].totals.people).toBe(3);
    expect(events.at(-1)!.phase).toBe('done');
  });

  it('runs the after-day hook once per replayed day and adds its counts to that day', async () => {
    const events: IngestProgress[] = [];
    const hooked: number[] = [];
    const afterDay = async (day: number) => {
      hooked.push(day);
      return { knows: day * 10 };
    };
    await service.runReplay(replayGraph, { fromDay: 1, toDay: 3, delayMs: 0, reset: true }, async (p) => void events.push(p), undefined, afterDay);

    expect(hooked).toEqual([1, 2, 3]);
    const days = events.filter((e) => e.phase === 'day');
    expect(days.map((e) => e.added.knows)).toEqual([10, 20, 30]);
    expect(days[0].message).toContain('expertise refreshed (10 KNOWS)');
  });

  it('stores artifact bodies in the TextStore, not the graph', async () => {
    await expect(new LocalTextStore(dataDir).get('artifacts', 'zoom_1')).resolves.toContain('**[10:00:00] Bo:**');
  });

  it('activity counts PARTICIPATED only where the person wrote a line', async () => {
    const copy = testGraphName(); // keep the full graph untouched
    await graph.copyGraph(fullGraph, copy);
    try {
      await graph.query(copy, BO_ON_DAY_9_THREAD, { wrote: false });
      await graph.query(copy, UPDATE_PERSON_ACTIVITY);
      await expect(graph.roQuery(copy, BO_ACTIVITY)).resolves.toEqual([{ firstDay: 1, lastSeenDay: 3 }]); // listed only: ignored
      await graph.query(copy, BO_ON_DAY_9_THREAD, { wrote: true });
      await graph.query(copy, UPDATE_PERSON_ACTIVITY);
      await expect(graph.roQuery(copy, BO_ACTIVITY)).resolves.toEqual([{ firstDay: 1, lastSeenDay: 9 }]);
    } finally {
      await graph.deleteGraph(copy).catch(() => undefined);
    }
  });

  it('an HR announcement sets departedDay (via the calendar) and keeps the announcement as evidence', async () => {
    const copy = testGraphName();
    const announcement = record({
      doc_id: 'slack_hr_ops_2026-01-05T10:00:00',
      doc_type: 'slack',
      day: 3,
      actors: ['Ada'],
      body: "Ada: Bo's last day is 2026-01-06. Please revoke access after that.",
    });
    const calendar = calendarFrom({ lastDay: 4, days: [{ day: 3, date: '2026-01-05' }, { day: 4, date: '2026-01-06' }] });
    try {
      await service.runFull(copy, async () => undefined, buildPlan([...MINI_RECORDS, announcement], calendar));
      // Active is "not departed": departedDay is set, so Bo is no longer active after ingest.
      await expect(graph.roQuery(copy, DEPARTURES)).resolves.toEqual([
        { person: 'Bo', departedDay: 4, active: false, announcedIn: ['slack_hr_ops_2026-01-05T10:00:00'] },
      ]);
    } finally {
      await graph.deleteGraph(copy).catch(() => undefined);
    }
  });
});
