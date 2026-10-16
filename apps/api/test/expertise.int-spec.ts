import { CLEAR_EXTRACTION } from '../src/extract/queries/extract.queries';
import { ExtractService } from '../src/extract/extract.service';
import { ExpertiseService } from '../src/analytics/expertise.service';
import { ProjectionService } from '../src/projection/projection.service';
import { useFixtureGraph } from './graph-test-utils';
import { ALL_KNOWS, EXTRACTION_SUMMARY, GIVE_D1_A_SOURCE, PROJECTION_COLLAB_PAIRS } from './queries/test.queries';

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
    const refreshed = await new ExpertiseService(fx.graph).refresh({ graph });
    expect(refreshed).toMatchObject({ asOfDay: 12, knows: 10, collab: 6 });

    const scores = (await fx.graph.roQuery<{ score: number }>(graph, ALL_KNOWS)).map((k) => k.score).sort((a, b) => a - b);
    const d = refreshed.distribution;
    expect(d.n).toBe(10);
    expect(d.min).toBeCloseTo(scores[0], 6);
    expect(d.max).toBeCloseTo(scores[9], 6);
    expect(d.min! <= d.p25! && d.p25! <= d.median! && d.median! <= d.p75! && d.p75! <= d.p90! && d.p90! <= d.max!).toBe(true);
  });

  it('deletes KNOWS that decayed below 0.05 (DELETE_WEAK_KNOWS) and rebuilds from scratch (DELETE_ALL_KNOWS)', async () => {
    const graph = await copyOfFixture('weak');
    const expertise = new ExpertiseService(fx.graph);
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
    await new ExpertiseService(fx.graph).refresh({ graph, asOfDay: 12 });
    const summary = await new ProjectionService(fx.graph).rebuild(`${graph}_proj`, { sourceGraph: graph, pageSize: 3 });
    copies.push(`${graph}_proj`);
    // Same numbers as with one page: 4 active people, 4 systems, 8 KNOWS, 4 pairs both ways.
    expect(summary).toMatchObject({ people: 4, systems: 4, knows: 8, collab: 8, collabMinWeight: 1 });
  });

  it('keeps only COLLAB pairs at or above the weight percentile', async () => {
    const graph = await copyOfFixture('collab');
    await new ExpertiseService(fx.graph).refresh({ graph, asOfDay: 12 });
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

    const expertise = new ExpertiseService(fx.graph);
    await expertise.refresh({ graph: source, asOfDay: 12 });
    await expertise.refresh({ graph: target, asOfDay: 12 });
    await expect(fx.graph.roQuery(target, ALL_KNOWS)).resolves.toEqual(await fx.graph.roQuery(source, ALL_KNOWS));
  });
});
