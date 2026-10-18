import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionsService } from '../src/actions/actions.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ActionsExportService, type ExportedAction } from '../src/backup/actions-export.service';
import { countPeople } from '../src/backup/count-people';
import { LocalExportStore } from '../src/backup/export-store';
import type { GraphLock } from '../src/backup/graph-lock';
import { ProjectionService } from '../src/projection/projection.service';
import { WhatIfService } from '../src/whatif/whatif.service';
import { loadFixture } from './fixture-loader';
import { fixtureExpertise, testGraphName, useFixtureGraph } from './graph-test-utils';
import { ACTION_COUNT, TICKET_ASSIGNEES } from './queries/test.queries';

/**
 * Actions export and restore (backup.queries.ts) on the mini-company fixture: a
 * handover plan for Dev is drafted and its reassignment of T-4 to Ada approved,
 * a runbook task is rejected; then everything is exported and restored into a
 * fresh copy of the fixture, as the seed command does after rebuilding from files.
 */
describe('actions export and restore on the fixture graph', () => {
  // Declared before useFixtureGraph, so it runs before that helper disconnects.
  afterAll(async () => {
    for (const g of (await fx.graph.listGraphs()).filter((n) => n.startsWith(`${fx.name}_`) || n === fresh)) await fx.graph.deleteGraph(g);
    await rm(dir, { recursive: true, force: true });
  });

  const fx = useFixtureGraph();
  const fresh = testGraphName();
  const projection = () => `${fx.name}_proj`;
  const noLock = { holder: async () => null } as unknown as GraphLock;
  let dir = '';
  let exporter: ActionsExportService;
  let reassignId = '';
  let planId = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keystone-export-'));
    exporter = new ActionsExportService(fx.graph, new LocalExportStore(dir), noLock);
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 });
    await new ProjectionService(fx.graph).rebuild(projection(), { sourceGraph: fx.name });
    const analytics = new AnalyticsService(fx.graph);
    const whatIf = new WhatIfService(fx.graph, analytics, new ProjectionService(fx.graph), {
      maxConcurrent: 2,
      sourceGraph: fx.name,
      projectionGraph: projection(),
      scratchPrefix: `${fx.name}_whatif_`,
    });
    const llm = { generateObjectWithUsage: async () => ({ value: { summary: 'A short summary.' }, usage: {}, cached: true }) };
    const actions = new ActionsService(fx.graph, whatIf, analytics, llm as never, { graph: fx.name, projectionGraph: projection() });
    const { plan, children } = await actions.draftHandover('Dev');
    planId = plan.id;
    reassignId = children.find((c) => c.kind === 'reassign')!.id;
    await actions.approve(reassignId);
    const { action: runbook } = await actions.createRunbookTask('PaymentsAPI');
    await actions.reject(runbook.id, 'already written');
    await loadFixture(fx.graph, fresh, 'mini-company');
  });

  const actionCount = async (graph: string) => (await fx.graph.roQuery<{ actions: number }>(graph, ACTION_COUNT))[0].actions;

  it('PERSON_COUNT counts the people; a graph that does not exist counts 0', async () => {
    expect(await countPeople(fx.graph, fx.name)).toBeGreaterThan(0);
    expect(await countPeople(fx.graph, testGraphName())).toBe(0);
  });

  it('EXPORT_ACTIONS returns every action with all its properties and edges', async () => {
    const exported = await exporter.readActions(fx.name);
    expect(exported).toHaveLength(await actionCount(fx.name));
    expect(exported.map((a) => a.id)).toEqual([...exported.map((a) => a.id)].sort());
    const reassign = exported.find((a) => a.id === reassignId)!;
    expect(reassign).toMatchObject({ targetType: 'Ticket', target: 'T-4', assignsTo: 'Ada', partOfPlan: planId });
    expect(reassign.props).toMatchObject({ id: reassignId, kind: 'reassign', status: 'approved', approvedDay: 12, fromPerson: 'Dev' });
    expect(reassign.basedOn.length).toBeGreaterThan(0);
    expect(exported.find((a) => a.id === planId)).toMatchObject({ targetType: 'Person', target: 'Dev', partOfPlan: null });
    expect(exported.find((a) => a.props.status === 'rejected')).toMatchObject({ targetType: 'System', target: 'PaymentsAPI' });
  });

  it('exportNow writes a timestamped file and actions-latest.jsonl with the same lines', async () => {
    const result = await exporter.exportNow(fx.name);
    expect(result).toMatchObject({ status: 'done', actions: await actionCount(fx.name) });
    const files = (await readdir(join(dir, 'exports'))).sort();
    expect(files).toEqual([expect.stringMatching(/^actions-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.jsonl$/), 'actions-latest.jsonl']);
    const [stamped, latest] = await Promise.all(files.map((f) => readFile(join(dir, 'exports', f), 'utf8')));
    expect(stamped).toBe(latest);
    expect(await exporter.readLatest()).toEqual(await exporter.readActions(fx.name));
  });

  it('skips the export while a seed runs, so a half-built graph never replaces actions-latest.jsonl', async () => {
    const busy = { holder: async () => ({ op: 'seed', owner: 'x', startedAt: 0 }) } as unknown as GraphLock;
    await expect(new ActionsExportService(fx.graph, new LocalExportStore(dir), busy).exportNow(fx.name)).resolves.toMatchObject({ status: 'skipped' });
  });

  it('RESTORE_ACTION_NODES / RESTORE_ACTION_EDGES / REAPPLY_APPROVED_REASSIGNMENT rebuild the actions on a fresh graph', async () => {
    await expect(fx.graph.roQuery(fresh, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toEqual([{ person: 'Dev', day: 11, via: null, status: 'in_progress' }]);
    const summary = await exporter.restoreLatestInto(fresh);
    expect(summary).toMatchObject({ actions: await actionCount(fx.name), reassignments: 1, unresolvedTargets: [] });
    expect(summary.source).toBe(join(dir, 'exports', 'actions-latest.jsonl'));
    expect(await exporter.readActions(fresh)).toEqual(await exporter.readActions(fx.name));
    // The approval moved T-4 from Dev to Ada; the rebuilt graph gets the same move.
    await expect(fx.graph.roQuery(fresh, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toEqual([
      { person: 'Ada', day: 12, via: reassignId, status: 'in_progress' },
    ]);
  });

  it('restoring the same export again changes nothing', async () => {
    const before = await exporter.readActions(fresh);
    await exporter.restoreLatestInto(fresh);
    expect(await exporter.readActions(fresh)).toEqual(before);
    await expect(fx.graph.roQuery(fresh, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toEqual([
      { person: 'Ada', day: 12, via: reassignId, status: 'in_progress' },
    ]);
  });

  it('never undoes a decision: an older export where the action was still proposed keeps it approved', async () => {
    const older = (await exporter.readActions(fx.name)).map((a): ExportedAction =>
      a.id === reassignId ? { ...a, props: { ...a.props, status: 'proposed', approvedAt: undefined, approvedDay: undefined } } : a,
    );
    older.forEach((a) => Object.keys(a.props).forEach((k) => a.props[k] === undefined && delete a.props[k]));
    await exporter.restoreInto(fresh, older);
    expect((await exporter.readActions(fresh)).find((a) => a.id === reassignId)?.props.status).toBe('approved');
  });

  it('reports an action whose target no longer exists, and still restores it', async () => {
    const orphan: ExportedAction = {
      id: 'act-ffffffffffff',
      props: { id: 'act-ffffffffffff', kind: 'runbook', status: 'proposed', day: 12, reason: 'x', createdBy: 'keystone', createdAt: 1 },
      targetType: 'System',
      target: 'NoSuchSystem',
      assignsTo: 'Ada',
      partOfPlan: null,
      basedOn: ['NOPE-1'],
    };
    const summary = await exporter.restoreInto(fresh, [orphan]);
    expect(summary.unresolvedTargets).toEqual(['act-ffffffffffff']);
    expect((await exporter.readActions(fresh)).find((a) => a.id === orphan.id)).toMatchObject({ target: null, assignsTo: 'Ada', basedOn: [] });
  });

  it('replaceGraph copies a graph over an existing one, with no _incoming graph left behind', async () => {
    const copy = `${fx.name}_copy`;
    await fx.graph.replaceGraph(fx.name, copy);
    await fx.graph.replaceGraph(fx.name, copy); // the target exists now: replaced by a fresh copy
    expect(await countPeople(fx.graph, copy)).toBe(await countPeople(fx.graph, fx.name));
    expect(await actionCount(copy)).toBe(await actionCount(fx.name));
    expect(await fx.graph.graphExists(`${copy}_incoming`)).toBe(false);
  });

  it('replaceGraph leaves the target untouched when the copy fails (a failed backup keeps the old backup)', async () => {
    const copy = `${fx.name}_copy`;
    const before = await countPeople(fx.graph, copy);
    await expect(fx.graph.replaceGraph(`${fx.name}_does_not_exist`, copy)).rejects.toThrow();
    expect(await countPeople(fx.graph, copy)).toBe(before);
    expect(await fx.graph.graphExists(`${copy}_incoming`)).toBe(false);
  });

  it('renameGraph moves a graph over an existing one in one step, indexes included', async () => {
    const from = `${fx.name}_renamefrom`;
    const to = `${fx.name}_renameto`;
    await fx.graph.copyGraph(fx.name, from);
    await fx.graph.query(to, "CREATE (:Person {name: 'Old'})");
    await fx.graph.renameGraph(from, to);
    expect(await fx.graph.graphExists(from)).toBe(false);
    expect(await countPeople(fx.graph, to)).toBe(await countPeople(fx.graph, fx.name));
    await expect(fx.graph.roQuery(to, "MATCH (p:Person {name: 'Old'}) RETURN p.name AS name")).resolves.toEqual([]);
    await expect(fx.graph.roQuery(to, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toHaveLength(1); // still queryable
  });

  it('a live graph with people but no actions (an accidental full ingest) never erases approvals in actions-latest.jsonl', async () => {
    const wiped = testGraphName();
    await loadFixture(fx.graph, wiped, 'mini-company'); // people, but none of the actions
    const target = testGraphName();
    await loadFixture(fx.graph, target, 'mini-company');
    try {
      const live = await exporter.snapshotActions(wiped);
      expect(live).toEqual([]);
      const latest = await readFile(join(dir, 'exports', 'actions-latest.jsonl'), 'utf8');
      const summary = await exporter.restoreLatestInto(target, live);
      expect(summary).toMatchObject({ actions: await actionCount(fx.name), reassignments: 1 });
      expect((await exporter.readActions(target)).find((a) => a.id === reassignId)?.props.status).toBe('approved');
      // The snapshot went to its own timestamped file; actions-latest.jsonl is unchanged.
      expect(await readFile(join(dir, 'exports', 'actions-latest.jsonl'), 'utf8')).toBe(latest);
      // ...and the (empty) pre-replace state is kept on its own, as a record.
      const snapshots = (await readdir(join(dir, 'exports'))).filter((f) => f.endsWith('-before-replace.jsonl'));
      expect(snapshots.length).toBeGreaterThan(0);
      expect(await readFile(join(dir, 'exports', snapshots.sort().at(-1)!), 'utf8')).toBe('');
    } finally {
      await fx.graph.deleteGraph(wiped);
      await fx.graph.deleteGraph(target);
    }
  });

  it('a newer live snapshot is merged after the latest export: its approval wins over an older "proposed"', async () => {
    const target = testGraphName();
    await loadFixture(fx.graph, target, 'mini-company');
    try {
      const older = (await exporter.readActions(fx.name)).map((a): ExportedAction =>
        a.id === reassignId ? { ...a, props: Object.fromEntries(Object.entries(a.props).filter(([k]) => k !== 'approvedAt' && k !== 'approvedDay').map(([k, v]) => [k, k === 'status' ? 'proposed' : v])) } : a,
      );
      await exporter.restoreInto(target, older); // what an old actions-latest.jsonl had
      const live = await exporter.snapshotActions(fx.name); // approved in the live graph
      await exporter.restoreInto(target, live);
      expect((await exporter.readActions(target)).find((a) => a.id === reassignId)?.props.status).toBe('approved');
      expect((await readdir(join(dir, 'exports'))).some((f) => f.endsWith('-before-replace.jsonl'))).toBe(true);
    } finally {
      await fx.graph.deleteGraph(target);
    }
  });

});
