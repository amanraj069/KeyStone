import { AnalyticsService } from '../src/analytics/analytics.service';
import { CORE_MIN_AUTHORS, DEFAULT_CORE_MIN_MENTIONS } from '../src/catalog/catalog.constants';
import { CatalogService } from '../src/catalog/catalog.service';
import { ProjectionService } from '../src/projection/projection.service';
import { fixtureExpertise, testGraphName, useFixtureGraph } from './graph-test-utils';
import { ADD_TITAN_DUPLICATE, BACKUP_FIXTURE, IDF_FIXTURE, PROJECTION_COLLAB_PAIRS, SYSTEM_STATS, TITAN_EDGES, WORKLOAD_FIXTURE } from './queries/test.queries';

/**
 * System catalog on the mini-company fixture: statistics, core flag, idf,
 * merging duplicates, and the core-only / idf-weighted analytics queries.
 * Fixture: TitanDB and MobileApp are each mentioned by 5 artifacts from 3 authors;
 * PaymentsAPI (Ada) and LegacyAuth (Cara) by 2 artifacts from 1 author. 13 artifacts.
 */
describe('System catalog on the fixture graph', () => {
  const fx = useFixtureGraph();
  const DEFAULT_RULE = { coreMinMentions: DEFAULT_CORE_MIN_MENTIONS, coreMinAuthors: CORE_MIN_AUTHORS };
  const created: string[] = [];

  async function copyOfFixture(suffix: string): Promise<string> {
    const name = `${fx.name}_${suffix}`;
    await fx.graph.copyGraph(fx.name, name);
    created.push(name);
    return name;
  }

  afterAll(async () => {
    for (const graph of created) await fx.graph.deleteGraph(graph).catch(() => undefined);
  });

  it('writes mentionCount, authorCount, core (5 mentions by 2+ people) and idf on every System', async () => {
    const graph = await copyOfFixture('stats');
    await expect(new CatalogService(fx.graph, DEFAULT_RULE).refreshStats(graph)).resolves.toEqual({ systems: 4, core: 2 });
    const stats = await fx.graph.roQuery<{ name: string; mentionCount: number; authorCount: number; core: boolean; idf: number }>(graph, SYSTEM_STATS);
    expect(stats.map((s) => ({ name: s.name, mentionCount: s.mentionCount, authorCount: s.authorCount, core: s.core }))).toEqual([
      { name: 'LegacyAuth', mentionCount: 2, authorCount: 1, core: false },
      { name: 'MobileApp', mentionCount: 5, authorCount: 3, core: true },
      { name: 'PaymentsAPI', mentionCount: 2, authorCount: 1, core: false },
      { name: 'TitanDB', mentionCount: 5, authorCount: 3, core: true },
    ]);
    expect(stats.find((s) => s.name === 'TitanDB')!.idf).toBeCloseTo(Math.log(13 / 6), 6);
    expect(stats.find((s) => s.name === 'PaymentsAPI')!.idf).toBeCloseTo(Math.log(13 / 3), 6);
  });

  it('reports distributions in bucket order, and core counts per threshold', async () => {
    const graph = await copyOfFixture('report');
    const catalog = new CatalogService(fx.graph, DEFAULT_RULE);
    await catalog.refreshStats(graph);
    const report = await catalog.report(graph, 2);
    expect(report.byMentions).toEqual([
      expect.objectContaining({ bucket: '2', systems: 2 }),
      expect.objectContaining({ bucket: '5-9', systems: 2 }),
    ]);
    expect(report.byAuthors.map((b) => b.bucket)).toEqual(['1', '3-4']);
    expect(report.top.map((s) => s.name)).toEqual(['MobileApp', 'TitanDB']);
    await expect(catalog.coreCountsAt(graph, [2, 5, 6])).resolves.toEqual([
      { minMentions: 2, core: 2 }, // PaymentsAPI and LegacyAuth have one author each
      { minMentions: 5, core: 2 },
      { minMentions: 6, core: 0 },
    ]);
  });

  it('merges a duplicate into its survivor: MENTIONS (higher weight kept), ABOUT and aliases move, the node goes', async () => {
    const graph = await copyOfFixture('merge');
    await fx.graph.query(graph, ADD_TITAN_DUPLICATE);
    const catalog = new CatalogService(fx.graph, DEFAULT_RULE);
    const groups = await catalog.planAutomaticMerges(graph);
    expect(groups).toEqual([{ keep: 'TitanDB', merge: ['TitanDB v2'] }]);

    await expect(catalog.applyMerges(graph, groups)).resolves.toEqual({ merged: 1, systems: 4, core: 2 });
    const [titan] = await fx.graph.roQuery<{ artifacts: { id: string; weight: number }[]; decisions: string[]; aliases: string[] }>(graph, TITAN_EDGES);
    expect(titan.artifacts).toEqual([
      { id: 'P-1', weight: 5 }, // moved
      { id: 'PR-1', weight: 2 },
      { id: 'PR-2', weight: 2 },
      { id: 'T-1', weight: 3 }, // already mentioned TitanDB with a higher weight
      { id: 'T-2', weight: 1 },
      { id: 'T-4', weight: 1 },
    ]);
    expect(titan.decisions).toEqual(['D-1']);
    // Its own aliases from the fixture, then the merged name and the merged node's aliases.
    expect(titan.aliases).toEqual(['titan', 'titan db', 'TitanDB v2', 'titan v2']);
  });

  it('bus factor, risk counts and departure impact only count core systems (K4, K5)', async () => {
    const graph = await copyOfFixture('core');
    await fixtureExpertise(fx.graph, DEFAULT_RULE).refresh({ graph, asOfDay: 12 });
    const analytics = new AnalyticsService(fx.graph);
    const bus = await analytics.busFactor(0.05, graph);
    expect(bus.map((r) => r.system).sort()).toEqual(['MobileApp', 'TitanDB']);
    // Ada was the only PaymentsAPI expert, but PaymentsAPI is not core: no orphaned system.
    const impact = await analytics.departureImpact('Ada', 0.05, graph);
    expect(impact.systems.map((s) => s.system).sort()).toEqual(['MobileApp', 'TitanDB']);
    expect(impact.orphanedSystems).toEqual([]);
  });

  it('the projection keeps core systems and their KNOWS only', async () => {
    const graph = await copyOfFixture('core_proj');
    await fixtureExpertise(fx.graph, DEFAULT_RULE).refresh({ graph, asOfDay: 12 });
    const summary = await new ProjectionService(fx.graph).rebuild(`${graph}_proj`, { sourceGraph: graph });
    created.push(`${graph}_proj`);
    // KNOWS: TitanDB Ada/Ben/Dev + MobileApp Ada/Ben/Dev/Eve; COLLAB is about people and is unchanged.
    expect(summary).toMatchObject({ people: 4, systems: 2, knows: 7, collab: 8 });
    await expect(fx.graph.roQuery(`${graph}_proj`, PROJECTION_COLLAB_PAIRS)).resolves.toHaveLength(4);
  });

  it('owner fit is weighted by idf: the niche specialist beats the generalist (K6)', async () => {
    const graph = testGraphName();
    created.push(graph);
    await fx.graph.query(graph, IDF_FIXTURE);
    await new CatalogService(fx.graph, DEFAULT_RULE).refreshStats(graph);
    const impact = await new AnalyticsService(fx.graph).departureImpact('Leaver', 0.05, graph);
    // Raw scores: Gen 5.0 vs Spec 2.0. Weighted: Gen 5.0 x 0 = 0, Spec 2.0 x ln(4) = 2.8.
    expect(impact.openTickets).toEqual([
      { ticket: 'T-9', title: 'Fix niche export', suggestedOwners: ['Spec', 'Gen'], ownerEvidence: [['N-1'], ['A-1']] },
    ]);
  });

  it('an expert needs 25% of the top score too: TitanDB keeps Ada and Ben, not Dev (K4, K5)', async () => {
    const graph = await copyOfFixture('expert_rule');
    await fixtureExpertise(fx.graph).refresh({ graph, asOfDay: 12 });
    const analytics = new AnalyticsService(fx.graph);
    const withRule = await analytics.busFactor(0.05, graph, 0.25);
    const floorOnly = await analytics.busFactor(0.05, graph, 0);
    expect(withRule.find((r) => r.system === 'TitanDB')!.names.sort()).toEqual(['Ada', 'Ben']);
    expect(floorOnly.find((r) => r.system === 'TitanDB')!.names.sort()).toEqual(['Ada', 'Ben', 'Dev']);
    // Departure of Ben: TitanDB keeps one backup (Ada); Dev does not count.
    const impact = await analytics.departureImpact('Ben', 0.05, graph, 0.25);
    expect(impact.systems.find((s) => s.system === 'TitanDB')).toMatchObject({ backups: 1, backupNames: ['Ada'] });
  });

  it('owner fit is divided by 1 + open tickets / 5: the free person beats the busy one (K6)', async () => {
    const graph = testGraphName();
    created.push(graph);
    await fx.graph.query(graph, WORKLOAD_FIXTURE);
    await new CatalogService(fx.graph, DEFAULT_RULE).refreshStats(graph);
    const impact = await new AnalyticsService(fx.graph).departureImpact('Leaver', 0.05, graph);
    expect(impact.openTickets).toEqual([
      { ticket: 'T-7', title: 'Niche export', suggestedOwners: ['Free', 'Busy'], ownerEvidence: [['F-1'], ['B-1']] },
    ]);
  });

  it('K5 measures backups against the top score of the people who remain', async () => {
    const graph = testGraphName();
    created.push(graph);
    await fx.graph.query(graph, BACKUP_FIXTURE);
    const impact = await new AnalyticsService(fx.graph).departureImpact('Leaver', 0.4, graph, 0.25);
    // Other (2.0) is below 25% of Leaver (10.0), but once Leaver is gone Other is the top: a backup.
    expect(impact.systems).toEqual([expect.objectContaining({ system: 'S', backups: 1, backupNames: ['Other'] })]);
    expect(impact.orphanedSystems).toEqual([]);
  });
});
