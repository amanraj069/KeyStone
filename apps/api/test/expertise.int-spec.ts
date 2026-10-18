import { CLEAR_EXTRACTION } from '../src/extract/queries/extract.queries';
import { ExtractService } from '../src/extract/extract.service';
import { ProjectionService } from '../src/projection/projection.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { MERGE_DEPARTURES } from '../src/ingest/queries/ingest.queries';
import {
  ADD_STACK_LIST_PAGE,
  ALL_KNOWS,
  DEPARTURES,
  COLLAB_WEIGHT,
  EVE_JOINS_MEETING,
  EXTRACTION_SUMMARY,
  GIVE_D1_A_SOURCE,
  KNOWS_EVIDENCE,
  KNOWS_SCORE,
  MENTIONED_SYSTEMS,
  PROJECTION_COLLAB_PAIRS,
} from './queries/test.queries';

/**
 * Stage 7 refresh, projection and replay queries on copies of the mini-company
 * fixture (each test that writes works on its own copy).
 */
describe('Stage 7 expertise refresh, projection and replay on the fixture graph', () => {
  const fx = useFixtureGraph();
  const copies: string[] = [];

  /** A fresh copy of the fixture graph, deleted after the suite. */
  async function copyOfFixture(suffix: string): Promise<string> {
    const name = `${fx.name}_${suffix}`;
    await fx.graph.copyGraph(fx.name, name);
    copies.push(name);
    return name;
  }

  afterAll(async () => {
    for (const graph of copies) await fx.graph.deleteGraph(graph).catch(() => undefined);
  });

  it('refresh defaults to the last day with an artifact (LAST_ARTIFACT_DAY) and reports the KNOWS distribution', async () => {
    const graph = await copyOfFixture('last');
    const refreshed = await fixtureExpertise(fx.graph).refresh({ graph });
    expect(refreshed).toMatchObject({ asOfDay: 12, knows: 10, collab: 6 });

    const scores = (await fx.graph.roQuery<{ score: number }>(graph, ALL_KNOWS)).map((k) => k.score).sort((a, b) => a - b);
    const d = refreshed.distribution;
    expect(d.n).toBe(10);
    expect(d.min).toBeCloseTo(scores[0], 6);
    expect(d.max).toBeCloseTo(scores[9], 6);
    expect(d.min! <= d.p25! && d.p25! <= d.median! && d.median! <= d.p75! && d.p75! <= d.p90! && d.p90! <= d.max!).toBe(true);
  });

  it('KNOWS evidence lists the artifacts most about the system first; a page naming it in a list still counts (K2)', async () => {
    const graph = await copyOfFixture('relevance');
    const expertise = fixtureExpertise(fx.graph);
    await expertise.refresh({ graph, asOfDay: 12 });
    const [before] = await fx.graph.roQuery<{ score: number; evidence: string[] }>(graph, KNOWS_EVIDENCE, { person: 'Ada', system: 'TitanDB' });

    await fx.graph.query(graph, ADD_STACK_LIST_PAGE);
    await expertise.refresh({ graph, asOfDay: 12 });
    const [after] = await fx.graph.roQuery<{ score: number; evidence: string[] }>(graph, KNOWS_EVIDENCE, { person: 'Ada', system: 'TitanDB' });

    // Authored on the as-of day: it adds exactly 3 to the score, the same as before the ranking change.
    expect(after.score).toBeCloseTo(before.score + 3, 6);
    // Ranked by contribution x mention weight x 4 (title names TitanDB) / systems mentioned:
    // T-1 ~26.7, PR-1 ~12.7, T-2 ~10.2, T-4 ~5.8 (two systems), P-STACK 0.75 (newest, but four systems and no title match).
    expect(after.evidence).toEqual(['T-1', 'PR-1', 'T-2', 'T-4', 'P-STACK']);
    const counts = await fx.graph.roQuery<{ id: string; n: number }>(graph, MENTIONED_SYSTEMS, { ids: ['P-STACK', 'T-1', 'T-4'] });
    expect(counts).toEqual([{ id: 'P-STACK', n: 4 }, { id: 'T-1', n: 1 }, { id: 'T-4', n: 2 }]);
  });

  it('deletes KNOWS that decayed below 0.05 (DELETE_WEAK_KNOWS) and rebuilds from scratch (DELETE_ALL_KNOWS)', async () => {
    const graph = await copyOfFixture('weak');
    const expertise = fixtureExpertise(fx.graph);
    await expertise.refresh({ graph, asOfDay: 12 });
    // 200 days later every score is below 3 * 3 * e^(-188/30) < 0.05: nothing is left.
    await expect(expertise.refresh({ graph, asOfDay: 200 })).resolves.toMatchObject({ knows: 0 });
    // As of day 5 only artifacts from days 1-5 count; newer pairs must not survive from the earlier refresh.
    const asOf5 = await expertise.refresh({ graph, asOfDay: 5 });
    const pairs = (await fx.graph.roQuery<{ person: string; system: string }>(graph, ALL_KNOWS)).map((k) => `${k.person}/${k.system}`);
    expect(pairs).toEqual(['Ada/PaymentsAPI', 'Ada/TitanDB', 'Ben/TitanDB', 'Dev/MobileApp', 'Eve/MobileApp']);
    expect(asOf5.knows).toBe(5);
  });

  it('the projection summary carries its counts (PROJECTION_COUNTS) and reads page by page', async () => {
    const graph = await copyOfFixture('pages');
    await fixtureExpertise(fx.graph).refresh({ graph, asOfDay: 12 });
    const summary = await new ProjectionService(fx.graph).rebuild(`${graph}_proj`, { sourceGraph: graph, pageSize: 3 });
    copies.push(`${graph}_proj`);
    // Same numbers as with one page: 4 active people, 4 systems, 8 KNOWS, 4 pairs both ways.
    expect(summary).toMatchObject({ people: 4, systems: 4, knows: 8, collab: 8, collabMinWeight: 1 });
  });

  it('keeps only COLLAB pairs at or above the weight percentile', async () => {
    const graph = await copyOfFixture('collab');
    await fixtureExpertise(fx.graph).refresh({ graph, asOfDay: 12 });
    // Ada and Ben share T-1 and PR-1 (weight 2); every other active pair shares one artifact.
    const summary = await new ProjectionService(fx.graph).rebuild(`${graph}_proj`, { sourceGraph: graph, collabPercentile: 1 });
    copies.push(`${graph}_proj`);
    expect(summary.collabMinWeight).toBe(2);
    await expect(fx.graph.roQuery(`${graph}_proj`, PROJECTION_COLLAB_PAIRS)).resolves.toEqual([{ a: 'Ada', b: 'Ben', weight: 2 }]);
  });

  it('an as-of projection applies the percentile to that day’s weights', async () => {
    const graph = await copyOfFixture('collab_asof');
    const summary = await new ProjectionService(fx.graph).rebuild(`${graph}_proj`, { sourceGraph: graph, asOfDay: 4, collabPercentile: 1 });
    copies.push(`${graph}_proj`);
    // By day 4 only Ada and Ben share artifacts (T-1 day 3, PR-1 day 4): one pair, weight 2.
    // Days are the artifact's day, as in K2 (Ada's review of PR-1 on day 5 still counts).
    expect(summary).toMatchObject({ collabMinWeight: 2, collab: 2 });
  });

  it('replaying day by day copies the extraction (REPLAY_*_FOR_DAY) and gives the same KNOWS', async () => {
    const source = await copyOfFixture('src');
    await fx.graph.query(source, GIVE_D1_A_SOURCE);
    const target = await copyOfFixture('replay');
    await fx.graph.query(target, CLEAR_EXTRACTION);

    const extract = new ExtractService(fx.graph, {} as never, {} as never, {} as never, {} as never);
    let copied = 0;
    for (let day = 1; day <= 12; day++) copied += (await extract.replayDay(source, target, day)).mentions;
    // Replaying the same day twice changes nothing (all MERGE).
    await extract.replayDay(source, target, 10);

    const [before] = await fx.graph.roQuery<Record<string, number>>(source, EXTRACTION_SUMMARY);
    const [after] = await fx.graph.roQuery<Record<string, number>>(target, EXTRACTION_SUMMARY);
    // Everything except P-2's mention of LegacyAuth: P-2 has no day, so it is never replayed.
    expect(after).toEqual({ ...before, mentions: before.mentions - 1 });
    expect(copied).toBe(before.mentions - 1);
    expect(after).toMatchObject({ decisions: 2, superseded: 1, supersedes: 1, asserts: 1 });

    const expertise = fixtureExpertise(fx.graph);
    await expertise.refresh({ graph: source, asOfDay: 12 });
    await expertise.refresh({ graph: target, asOfDay: 12 });
    await expect(fx.graph.roQuery(target, ALL_KNOWS)).resolves.toEqual(await fx.graph.roQuery(source, ALL_KNOWS));
  });

  it('K2 weights: AUTHORED 3, REVIEWED 2, ASSIGNED 1, PARTICIPATED 0.5 x min(messages, 4) / 4, with decay', async () => {
    const graph = await copyOfFixture('weights');
    await fx.graph.query(graph, EVE_JOINS_MEETING);
    await fixtureExpertise(fx.graph).refresh({ graph, asOfDay: 12 });
    const score = async (person: string, system: string) =>
      (await fx.graph.roQuery<{ score: number }>(graph, KNOWS_SCORE, { person, system }))[0].score;
    const decay = (day: number) => Math.exp(-(12 - day) / 30);
    // Dev on MobileApp: owns T-3 (day 5) and T-4 (day 11), spoke 6 times in M-1 (day 10, capped at 4),
    // wrote P-3 (day 3) and PR-3 (day 12).
    expect(await score('Dev', 'MobileApp')).toBeCloseTo(decay(5) + decay(11) + 0.5 * decay(10) + 3 * decay(3) + 3 * decay(12), 6);
    // Eve: wrote T-3 (day 5) and said one line in M-1: 0.5 x 1/4 = 0.125.
    expect(await score('Eve', 'MobileApp')).toBeCloseTo(3 * decay(5) + 0.125 * decay(10), 6);
  });

  it('K8a counts PARTICIPATED: a shared meeting adds to COLLAB', async () => {
    const graph = await copyOfFixture('collab_part');
    const expertise = fixtureExpertise(fx.graph);
    await expertise.refresh({ graph, asOfDay: 12 });
    await expect(fx.graph.roQuery(graph, COLLAB_WEIGHT, { a: 'Dev', b: 'Eve' })).resolves.toEqual([{ weight: 1 }]); // T-3
    await fx.graph.query(graph, EVE_JOINS_MEETING);
    await expertise.refresh({ graph, asOfDay: 12 });
    await expect(fx.graph.roQuery(graph, COLLAB_WEIGHT, { a: 'Dev', b: 'Eve' })).resolves.toEqual([{ weight: 2 }]); // T-3 + M-1
  });

  it('K3b evidence paths include meetings the person took part in', async () => {
    const graph = await copyOfFixture('evidence_part');
    await fixtureExpertise(fx.graph).refresh({ graph, asOfDay: 12 });
    const result = await new AnalyticsService(fx.graph).experts('MobileApp', graph);
    expect(result.evidencePath?.person).toBe('Dev');
    expect(result.evidencePath?.evidence).toContain('M-1');
    expect(result.evidencePath?.edges.map((e) => e.type)).toContain('PARTICIPATED');
  });

  it('a departed person keeps their history but is not an expert or suggested owner after their day', async () => {
    const graph = await copyOfFixture('departed');
    // Ben's departure is announced in TH-1 (day 6) for day 11.
    await fx.graph.batchWrite(graph, MERGE_DEPARTURES, [{ person: 'Ben', artifactId: 'TH-1', departedDay: 11 }]);
    const expertise = fixtureExpertise(fx.graph);
    const analytics = new AnalyticsService(fx.graph);

    await expertise.refresh({ graph, asOfDay: 12 });
    await expect(fx.graph.roQuery(graph, DEPARTURES)).resolves.toEqual([
      { person: 'Ben', departedDay: 11, active: false, announcedIn: ['TH-1'] },
      { person: 'Cara', departedDay: 12, active: false, announcedIn: [] },
    ]);
    // History stays: Ben still has KNOWS on TitanDB...
    const knows = await fx.graph.roQuery<{ person: string; system: string }>(graph, ALL_KNOWS);
    expect(knows.some((k) => k.person === 'Ben' && k.system === 'TitanDB')).toBe(true);
    // ...but he is no expert any more and is never suggested as an owner.
    const bus = await analytics.busFactor(0.05, graph, 0);
    expect(bus.find((r) => r.system === 'TitanDB')!.names.sort()).toEqual(['Ada', 'Dev']);
    const impact = await analytics.departureImpact('Dev', 0.05, graph);
    expect(impact.openTickets[0].suggestedOwners).not.toContain('Ben');

    // As of day 10 Ben had not left yet: active again, and in the as-of projection.
    await expertise.refresh({ graph, asOfDay: 10 });
    await expect(fx.graph.roQuery(graph, 'MATCH (p:Person {name: $name}) RETURN p.active AS active', { name: 'Ben' })).resolves.toEqual([{ active: true }]);
    const projection = new ProjectionService(fx.graph);
    const proj10 = `${graph}_p10`;
    const proj12 = `${graph}_p12`;
    copies.push(proj10, proj12);
    await projection.rebuild(proj10, { sourceGraph: graph, asOfDay: 10 });
    await projection.rebuild(proj12, { sourceGraph: graph, asOfDay: 12 });
    const names = async (g: string) => (await fx.graph.roQuery<{ name: string }>(g, 'MATCH (p:Person) RETURN p.name AS name ORDER BY name')).map((r) => r.name);
    expect(await names(proj10)).toEqual(['Ada', 'Ben', 'Cara', 'Dev', 'Eve']);
    expect(await names(proj12)).toEqual(['Ada', 'Dev', 'Eve']);
  });
});
