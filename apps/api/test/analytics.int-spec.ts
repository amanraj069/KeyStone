import { DONE_STATUSES } from '../src/analytics/analytics.constants';
import { AnalyticsService } from '../src/analytics/analytics.service';
import * as Q from '../src/analytics/queries/analytics.queries';
import { ProjectionService } from '../src/projection/projection.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';

/**
 * Stage 7 on the mini-company fixture (test/fixtures/mini-company.cypher):
 *   PaymentsAPI has a single active expert (Ada), LegacyAuth has none (Cara left),
 *   Dev is the only bridge between Engineering_Backend and Product, and page P-3
 *   asserts D-1, which D-2 superseded. Expertise is computed as of day 12.
 */
describe('Stage 7 analytics on the fixture graph', () => {
  const fx = useFixtureGraph();
  const projection = () => `${fx.name}_proj`;
  const projectionAsOf10 = () => `${fx.name}_proj10`;
  let analytics: AnalyticsService;

  beforeAll(async () => {
    const expertise = fixtureExpertise(fx.graph);
    const refreshed = await expertise.refresh({ graph: fx.name, asOfDay: 12 });
    // 10 person-system pairs and 6 collaborating pairs, as designed (P-2 has day null and is skipped).
    expect(refreshed).toMatchObject({ asOfDay: 12, knows: 10, collab: 6 });
    const projections = new ProjectionService(fx.graph);
    await projections.rebuild(projection(), { sourceGraph: fx.name });
    await projections.rebuild(projectionAsOf10(), { sourceGraph: fx.name, asOfDay: 10 });
    analytics = new AnalyticsService(fx.graph);
  });

  afterAll(async () => {
    for (const graph of [projection(), projectionAsOf10()]) await fx.graph.deleteGraph(graph).catch(() => undefined);
  });

  it('the projection has exactly the active people, all systems, their KNOWS and both-way COLLAB', async () => {
    const people = await fx.graph.roQuery<{ name: string }>(projection(), 'MATCH (p:Person) RETURN p.name AS name ORDER BY name');
    expect(people.map((p) => p.name)).toEqual(['Ada', 'Ben', 'Dev', 'Eve']); // Cara is inactive
    const [counts] = await fx.graph.roQuery(projection(), 'OPTIONAL MATCH (s:System) WITH count(s) AS systems OPTIONAL MATCH ()-[k:KNOWS]->() WITH systems, count(k) AS knows OPTIONAL MATCH ()-[c:COLLAB]->() RETURN systems, knows, count(c) AS collab');
    // KNOWS: TitanDB Ada/Ben/Dev, PaymentsAPI Ada, MobileApp Ada/Ben/Dev/Eve = 8.
    // COLLAB: Ada-Ben, Ada-Dev, Ben-Dev, Dev-Eve = 4 pairs, written both ways = 8.
    expect(counts).toEqual({ systems: 4, knows: 8, collab: 8 });
  });

  it('a projection as of day 10 recomputes KNOWS/COLLAB from that day (Cara still there, Dev not yet a bridge)', async () => {
    const people = await fx.graph.roQuery<{ name: string }>(projectionAsOf10(), 'MATCH (p:Person) RETURN p.name AS name ORDER BY name');
    expect(people.map((p) => p.name)).toEqual(['Ada', 'Ben', 'Cara', 'Dev', 'Eve']);
    const [counts] = await fx.graph.roQuery(projectionAsOf10(), 'OPTIONAL MATCH ()-[k:KNOWS]->() WITH count(k) AS knows OPTIONAL MATCH ()-[c:COLLAB]->() RETURN knows, count(c) AS collab');
    expect(counts).toEqual({ knows: 7, collab: 8 }); // T-4 (day 11) and PR-3 (day 12) are not counted yet
  });

  it('bus factor finds the orphaned and the single-expert systems (K4)', async () => {
    const rows = await analytics.busFactor(0.05, projection());
    const bySystem = Object.fromEntries(rows.map((r) => [r.system, r]));
    expect(bySystem.LegacyAuth).toMatchObject({ experts: 0, riskLevel: 'orphaned', names: [] });
    expect(bySystem.PaymentsAPI).toMatchObject({ experts: 1, riskLevel: 'critical', names: ['Ada'] });
    expect(bySystem.PaymentsAPI.evidence[0]).toEqual(expect.arrayContaining(['P-1', 'TH-1']));
    // Expert rule: score >= minScore and >= 25% of the top. Ada leads TitanDB (~9.2), Ben has ~4.9,
    // Dev only owns T-4 (~0.97 < 2.3), so TitanDB has two experts.
    expect(bySystem.TitanDB).toMatchObject({ experts: 2, riskLevel: 'watch', names: ['Ada', 'Ben'] });
    expect(rows[0].experts).toBe(0); // ordered by experts ascending
  });

  it('departure impact for the single expert lists that system with zero backups (K5, K6, K7)', async () => {
    const impact = await analytics.departureImpact('Ada', 0.05, fx.name);
    expect(impact.systems[0]).toMatchObject({ system: 'PaymentsAPI', backups: 0, backupNames: [] });
    expect(impact.systems[0].evidence).toEqual(expect.arrayContaining(['P-1', 'TH-1']));
    expect(impact.orphanedSystems).toEqual(['PaymentsAPI']);
    expect(impact.unsharedPages).toEqual([{ page: 'P-1', title: 'PaymentsAPI runbook' }]);
    // Ada owns no open ticket: T-1 and T-4 are authored by her, not assigned.
    expect(impact.openTickets).toEqual([]);
  });

  it('departure impact lists open tickets with suggested owners, skipping done ones (K6)', async () => {
    const impact = await analytics.departureImpact('Dev', 0.05, fx.name);
    // Dev owns T-3 (done) and T-4 (in_progress): only T-4 is open.
    expect(impact.openTickets).toHaveLength(1);
    expect(impact.openTickets[0]).toMatchObject({ ticket: 'T-4' });
    expect(impact.openTickets[0].suggestedOwners[0]).toBe('Ada'); // strongest on TitanDB + MobileApp
    expect(impact.openTickets[0].suggestedOwners).not.toContain('Dev');
    // One evidence list per suggested owner; Ada's includes her T-1 / T-4 work.
    expect(impact.openTickets[0].ownerEvidence).toHaveLength(impact.openTickets[0].suggestedOwners.length);
    expect(impact.openTickets[0].ownerEvidence[0].length).toBeGreaterThan(0);
  });

  it('a missing ticket status counts as open, and statuses compare case-insensitively', async () => {
    const rows = await fx.graph.roQuery(fx.name, Q.OPEN_TICKETS_COUNT, { doneStatuses: DONE_STATUSES });
    expect(rows).toEqual([{ open: 2 }]); // T-2 "open" (Cara) and T-4 "in_progress"; T-1 and T-3 are "done"
  });

  it('betweenness ranks the bridge person first (K8b on the projection)', async () => {
    const bridges = await analytics.bridges(projection(), fx.name);
    expect(bridges[0].person).toBe('Dev');
    expect(bridges[0].score).toBeGreaterThan(bridges[1].score);
    expect(bridges[0].evidence.length).toBeGreaterThan(0); // artifacts shared across departments
  });

  it('experts for a system come with an evidence graph for the top person (K3a, K3b)', async () => {
    const result = await analytics.experts('TitanDB', fx.name);
    expect(result.experts.map((e) => e.person)).toEqual(['Ada', 'Ben', 'Dev']); // Cara is inactive
    // relativeScore: a share of the top active expert, rounded to 2 decimals.
    expect(result.experts[0].relativeScore).toBe(1);
    for (const e of result.experts) expect(e.relativeScore).toBeCloseTo(e.score / result.experts[0].score, 2);
    expect(result.evidencePath?.person).toBe('Ada');
    expect([...(result.evidencePath?.evidence ?? [])].sort()).toEqual(['PR-1', 'T-1', 'T-2', 'T-4']);
    expect(result.evidencePath?.nodes).toHaveLength(6); // Ada, 4 artifacts, TitanDB
    expect(result.evidencePath?.edges).toHaveLength(8);
  });

  it("expert sources give each evidence id its title and the person's roles, in evidence order (K3c)", async () => {
    const sources = await analytics.expertSources([{ person: 'Ada', evidence: ['PR-1', 'NOPE', 'T-1'] }], fx.name);
    expect(sources.get('Ada')).toEqual([
      { id: 'PR-1', title: 'Fix TitanDB connection pool', type: 'pr', day: 4, roles: ['reviewed'] },
      { id: 'T-1', title: 'TitanDB latency spike', type: 'jira', day: 3, roles: ['authored'] },
    ]);
  });

  it('decision trace shows what replaced what, with the source and its authors (K10a)', async () => {
    const trace = await analytics.decisions('MobileApp', fx.name);
    expect(trace).toEqual([
      expect.objectContaining({ id: 'D-2', source: 'M-1', authors: ['Dev'], replacedId: 'D-1', replaced: 'MobileApp releases ship every two weeks' }),
    ]);
  });

  it('lists systems with decisions, counting the ones that replaced an earlier decision', async () => {
    await expect(analytics.systemsWithDecisions(fx.name)).resolves.toEqual([{ name: 'MobileApp', core: expect.any(Boolean), decisions: 2, changes: 1 }]);
  });

  it('stale docs finds the page asserting the superseded decision (K10b)', async () => {
    await expect(analytics.staleDocs(fx.name)).resolves.toEqual([
      expect.objectContaining({ stalePage: 'P-3', outdatedId: 'D-1', currentId: 'D-2', decidedIn: 'M-1' }),
    ]);
  });

  it('summary counts people, risk levels, stale docs and open tickets', async () => {
    const summary = await analytics.summary(0.05, fx.name, projection());
    expect(summary).toMatchObject({
      graph: fx.name,
      day: 12, // the latest artifact day (PR-3)
      people: { active: 4, inactive: 1 },
      systems: { orphaned: 1, critical: 1, watch: 1, ok: 1 }, // TitanDB: watch (see the bus factor test)
      staleDocs: 1,
      openTickets: 2,
    });
  });

  it('unknown names are 404s, and the projection refuses to overwrite apex', async () => {
    await expect(analytics.experts('NoSuchSystem', fx.name)).rejects.toThrow(/No system named/);
    await expect(analytics.departureImpact('Nobody', 1, fx.name)).rejects.toThrow(/No person named/);
    await expect(new ProjectionService(fx.graph).rebuild('apex')).rejects.toThrow(/Refusing/);
  });
});
