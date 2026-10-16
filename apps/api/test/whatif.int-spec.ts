import { ConflictException, NotFoundException } from '@nestjs/common';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ProjectionService } from '../src/projection/projection.service';
import { REMOVE_PERSON } from '../src/whatif/queries/whatif.queries';
import { WhatIfService } from '../src/whatif/whatif.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';
import { GRAPH_FINGERPRINT } from './queries/test.queries';

/**
 * Departure simulations on the mini-company fixture. Ada is the only expert on
 * PaymentsAPI (P-1, TH-1); TitanDB has Ada and Ben as experts (Dev is below 25%
 * of Ada's score); Cara has already left. Expertise as of day 12.
 */
describe('WhatIfService on the fixture graph', () => {
  // Registered before useFixtureGraph so it runs while the connection is still open
  // (Jest runs afterAll hooks in the order they were declared).
  afterAll(async () => {
    for (const g of [projection(), ...(await scratchGraphs())]) await fx.graph.deleteGraph(g);
  });
  const fx = useFixtureGraph();
  const projection = () => `${fx.name}_proj`;
  const prefix = () => `${fx.name}_whatif_`;
  let whatIf: WhatIfService;

  const scratchGraphs = async () => (await fx.graph.listGraphs()).filter((g) => g.startsWith(prefix()));
  const fingerprint = async () =>
    (await fx.graph.roQuery<{ kind: string; name: string; count: number }>(fx.name, GRAPH_FINGERPRINT))
      .map((r) => `${r.kind}:${r.name}=${r.count}`)
      .sort();

  beforeAll(async () => {
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 });
    await new ProjectionService(fx.graph).rebuild(projection(), { sourceGraph: fx.name });
    whatIf = new WhatIfService(fx.graph, new AnalyticsService(fx.graph), new ProjectionService(fx.graph), {
      maxConcurrent: 2,
      sourceGraph: fx.name,
      projectionGraph: projection(),
      scratchPrefix: prefix(),
    });
  });

  it('simulating the single expert leaving orphans exactly the system designed for it', async () => {
    const result = await whatIf.simulateDeparture('Ada');
    expect(result.systemsNewlyOrphaned.map((c) => c.system)).toEqual(['PaymentsAPI']);
    expect(result.systemsNewlyOrphaned[0]).toMatchObject({ expertsBefore: ['Ada'], expertsAfter: [] });
    expect(result.systemsNewlyOrphaned[0].evidence).toEqual(expect.arrayContaining(['P-1', 'TH-1']));
    // Nobody knows PaymentsAPI at all afterwards: a new knowledge island (K9). LegacyAuth was one already.
    expect(result.islandsCreated).toEqual([{ system: 'PaymentsAPI', evidence: expect.arrayContaining(['P-1', 'TH-1']) }]);
    // TitanDB keeps only Ben.
    expect(result.systemsNewlyCritical).toEqual([
      expect.objectContaining({ system: 'TitanDB', expertsBefore: ['Ada', 'Ben'], expertsAfter: ['Ben'] }),
    ]);
    expect(result.soleAuthoredPages).toEqual([{ page: 'P-1', title: 'PaymentsAPI runbook', evidence: ['P-1'] }]);
    expect(result.orphanedTickets).toEqual([]); // Ada owns no open ticket
    expect(result.bridgeShift.find((b) => b.person === 'Ada')?.after ?? null).toBeNull();
    // Animation data: Ada fades, PaymentsAPI turns red.
    const nodes = new Map(result.graph.nodes.map((n) => [n.id, n]));
    expect(nodes.get('person:Ada')).toMatchObject({ leaving: true });
    expect(nodes.get('system:PaymentsAPI')).toMatchObject({ orphaned: true, island: true });
    expect(nodes.get('system:TitanDB')).toMatchObject({ critical: true });
    expect(Object.keys(result.timingsMs)).toEqual(
      expect.arrayContaining(['validate', 'ensureProjection', 'copy', 'before', 'removePerson', 'after', 'departureImpact', 'cleanup', 'total']),
    );
    expect(result.scratchGraph.startsWith(prefix())).toBe(true);
    await expect(scratchGraphs()).resolves.toEqual([]); // the copy is gone
  });

  it('never changes the live graph', async () => {
    const before = await fingerprint();
    await whatIf.simulateDeparture('Dev');
    await expect(fingerprint()).resolves.toEqual(before);
    await expect(fx.graph.roQuery(fx.name, "MATCH (p:Person {name: 'Dev'}) RETURN p.name AS name")).resolves.toEqual([{ name: 'Dev' }]);
  });

  it('deletes the scratch graph even when a step fails midway', async () => {
    const original = fx.graph.query.bind(fx.graph);
    const spy = jest.spyOn(fx.graph, 'query').mockImplementation(async (graph, cypher, params) => {
      if (cypher === REMOVE_PERSON) throw new Error('simulated failure');
      return original(graph, cypher, params);
    });
    try {
      await expect(whatIf.simulateDeparture('Ben')).rejects.toThrow('simulated failure');
    } finally {
      spy.mockRestore();
    }
    await expect(scratchGraphs()).resolves.toEqual([]);
  });

  it('rebuilds a stale projection before copying it', async () => {
    const stamp = async () =>
      (await fx.graph.roQuery<{ builtAt: number }>(projection(), "MATCH (m:Meta {key: 'projection'}) RETURN m.builtAt AS builtAt"))[0].builtAt;
    const projections = new ProjectionService(fx.graph);
    await expect(projections.isFresh(projection(), fx.name)).resolves.toBe(true);
    const builtBefore = await stamp();
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 }); // newer expertise
    await expect(projections.isFresh(projection(), fx.name)).resolves.toBe(false);
    await whatIf.simulateDeparture('Eve');
    expect(await stamp()).toBeGreaterThan(builtBefore);
    await expect(projections.isFresh(projection(), fx.name)).resolves.toBe(true);
  });

  it('rejects unknown and already departed people', async () => {
    await expect(whatIf.simulateDeparture('Nobody')).rejects.toBeInstanceOf(NotFoundException);
    await expect(whatIf.simulateDeparture('Cara')).rejects.toBeInstanceOf(ConflictException);
  });

  it('the sweeper deletes leftover scratch graphs', async () => {
    const leftover = `${prefix()}leftover`;
    await fx.graph.copyGraph(projection(), leftover);
    await expect(whatIf.sweep()).resolves.toEqual([leftover]);
    await expect(scratchGraphs()).resolves.toEqual([]);
  });

  it('candidates rank people by how many core systems only they know (K5 for everyone)', async () => {
    const candidates = await whatIf.departureCandidates();
    expect(candidates).toEqual([{ person: 'Ada', dept: 'Engineering_Backend', orphaned: 1, systems: ['PaymentsAPI'], evidence: [expect.any(String)] }]);
  });

  it('concurrent simulations on a stale projection rebuild it only once', async () => {
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 }); // makes apex_proj stale
    const projections = new ProjectionService(fx.graph);
    const rebuild = jest.spyOn(projections, 'rebuild');
    const service = new WhatIfService(fx.graph, new AnalyticsService(fx.graph), projections, {
      maxConcurrent: 2,
      sourceGraph: fx.name,
      projectionGraph: projection(),
      scratchPrefix: prefix(),
    });
    const [ada, dev] = await Promise.all([service.simulateDeparture('Ada'), service.simulateDeparture('Dev')]);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(ada.systemsNewlyOrphaned.map((c) => c.system)).toEqual(['PaymentsAPI']);
    expect(dev.person).toBe('Dev');
    await expect(scratchGraphs()).resolves.toEqual([]);
  });
});
