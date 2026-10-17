import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActionsService } from '../src/actions/actions.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ProjectionService } from '../src/projection/projection.service';
import { WhatIfService } from '../src/whatif/whatif.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';
import { ACTION_COUNT, TICKET_ASSIGNEES } from './queries/test.queries';

/**
 * Proposed actions on the mini-company fixture (one flow, in order). Ada is the
 * only expert on PaymentsAPI and the only author of page P-1; Dev owns the open
 * ticket T-4 and is the only author of page P-3 (about MobileApp). Day 12 is "today".
 */
describe('ActionsService on the fixture graph', () => {
  const projection = () => `${fx.name}_proj`;
  afterAll(async () => {
    for (const g of (await fx.graph.listGraphs()).filter((n) => n.startsWith(`${fx.name}_`))) await fx.graph.deleteGraph(g);
  });
  const fx = useFixtureGraph();
  let actions: ActionsService;
  const count = async () => (await fx.graph.roQuery<{ actions: number }>(fx.name, ACTION_COUNT))[0].actions;
  const llm = { generateObjectWithUsage: jest.fn(async (): Promise<{ value: { summary: string }; usage: object; cached: boolean }> => ({ value: { summary: 'A short summary.' }, usage: {}, cached: true })) };

  beforeAll(async () => {
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 });
    await new ProjectionService(fx.graph).rebuild(projection(), { sourceGraph: fx.name });
    const analytics = new AnalyticsService(fx.graph);
    const whatIf = new WhatIfService(fx.graph, analytics, new ProjectionService(fx.graph), {
      maxConcurrent: 2,
      sourceGraph: fx.name,
      projectionGraph: projection(),
      scratchPrefix: `${fx.name}_whatif_`,
    });
    actions = new ActionsService(fx.graph, whatIf, analytics, llm as never, { graph: fx.name, projectionGraph: projection() });
  });

  let runbookId = '';
  it('a runbook task goes to the system\'s single expert, with the bus-factor evidence; then it is rejected', async () => {
    const { action, created } = await actions.createRunbookTask('PaymentsAPI');
    expect(created).toBe(true);
    expect(action).toMatchObject({ kind: 'runbook', status: 'proposed', targetType: 'System', target: 'PaymentsAPI', assignee: 'Ada', day: 12, createdBy: 'keystone' });
    expect(action.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(['P-1', 'TH-1']));
    runbookId = action.id;
    const rejected = await actions.reject(runbookId, 'Ada wrote it last month');
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Ada wrote it last month' });
    await expect(actions.reject(runbookId, 'again')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a handover plan for the single expert: a review of her only page and a runbook for the system only she knows', async () => {
    const { plan, created, children, skipped } = await actions.draftHandover('Ada');
    expect(created).toBe(true);
    expect(plan).toMatchObject({ kind: 'handover', status: 'proposed', targetType: 'Person', target: 'Ada', summary: 'A short summary.' });
    expect(children.map((c) => [c.kind, c.target, c.assignee]).sort()).toEqual([
      ['review_doc', 'P-1', null], // nobody else knows PaymentsAPI, so the review is unassigned
      ['runbook', 'PaymentsAPI', 'Ada'], // for her to write before she goes
    ]);
    expect(children.every((c) => c.planId === plan.id)).toBe(true);
    expect(plan.children.sort()).toEqual(children.map((c) => c.id).sort());
    expect(skipped).toEqual([]);
  });

  let reassignId = '';
  it("a handover plan reassigns the leaver's open ticket to the best suggested owner and the page to the best reviewer", async () => {
    const { children } = await actions.draftHandover('Dev');
    const reassign = children.find((c) => c.kind === 'reassign')!;
    expect(reassign).toMatchObject({ target: 'T-4', targetType: 'Ticket', assignee: 'Ada' });
    expect(reassign.evidence.length).toBeGreaterThan(0);
    expect(children.find((c) => c.kind === 'review_doc')).toMatchObject({ target: 'P-3', assignee: 'Ada' }); // MobileApp's strongest other expert
    reassignId = reassign.id;
  });

  it('does not create duplicates: an open proposal for the same ticket, or plan for the same person, is returned', async () => {
    const before = await count();
    const again = await actions.proposeReassignment('T-4', 'Ben', 'Ben could do it too');
    expect(again).toMatchObject({ created: false, action: { id: reassignId, assignee: 'Ada' } });
    const plan = await actions.draftHandover('Dev');
    expect(plan.created).toBe(false);
    expect(plan.children.map((c) => c.id)).toContain(reassignId);
    expect(await count()).toBe(before);
  });

  it('answers "why did Keystone suggest this?" from the graph in one query', async () => {
    const why = (await actions.why(reassignId)) as {
      reason: string;
      planFor: string;
      target: string;
      assignee: string;
      basedOn: { id: string; title: string; authors: string[] }[];
      assigneeExpertise: { system: string; score: number }[];
    };
    expect(why).toMatchObject({ target: 'T-4', assignee: 'Ada', planFor: 'Dev' });
    expect(why.reason).toContain('Dev is leaving');
    expect(why.basedOn.length).toBeGreaterThan(0);
    expect(why.basedOn[0].title).toEqual(expect.any(String));
    expect(why.assigneeExpertise.map((k) => k.system).sort()).toEqual(['MobileApp', 'TitanDB']);
  });

  it('draws the same trail as a graph: action, ticket, assignee, evidence and her KNOWS on the ticket\'s systems', async () => {
    const view = await actions.graphOf(reassignId);
    const byLabel = (label: string) => view.nodes.filter((n) => n.label === label).map((n) => n.name).sort();
    expect(byLabel('Action')).toEqual([reassignId]);
    expect(view.nodes.find((n) => n.artifactId === 'T-4')).toBeDefined();
    expect(byLabel('Person')).toEqual(['Ada']);
    expect(byLabel('System')).toEqual(['MobileApp', 'TitanDB']);
    expect(view.edges.map((e) => e.type)).toEqual(expect.arrayContaining(['TARGETS', 'ASSIGNS_TO', 'BASED_ON', 'MENTIONS', 'KNOWS']));
    await expect(actions.graphOf('act-000000000000')).rejects.toThrow(/No action/);
  });

  it('approving a reassignment moves the ASSIGNED edge, keeping the status, and records the action', async () => {
    await expect(fx.graph.roQuery(fx.name, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toEqual([
      { person: 'Dev', day: 11, via: null, status: 'in_progress' },
    ]);
    const approved = await actions.approve(reassignId);
    expect(approved).toMatchObject({ status: 'approved', moved: 1 });
    expect(approved.approvedAt).toEqual(expect.any(Number));
    await expect(fx.graph.roQuery(fx.name, TICKET_ASSIGNEES, { ticketId: 'T-4' })).resolves.toEqual([
      { person: 'Ada', day: 12, via: reassignId, status: 'in_progress' },
    ]);
    await expect(actions.approve(reassignId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists actions by status, newest first', async () => {
    expect((await actions.list('approved')).map((a) => a.id)).toEqual([reassignId]);
    expect((await actions.list('rejected')).map((a) => a.id)).toEqual([runbookId]);
    const all = await actions.list();
    expect(all.length).toBe(await count());
    expect(all.map((a) => a.createdAt)).toEqual([...all.map((a) => a.createdAt)].sort((x, y) => y - x));
  });

  it('refuses unknown targets and people who have left', async () => {
    await expect(actions.proposeReassignment('NOPE-1', 'Ada', 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(actions.proposeReassignment('T-1', 'Cara', 'x')).rejects.toBeInstanceOf(ConflictException);
    await expect(actions.createRunbookTask('NoSuchSystem')).rejects.toBeInstanceOf(NotFoundException);
    await expect(actions.approve('act-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a summary with a number that is not in the plan is replaced by the template', async () => {
    llm.generateObjectWithUsage.mockResolvedValueOnce({ value: { summary: 'Eve hands over 7 tickets.' }, usage: {}, cached: true });
    const { plan } = await actions.draftHandover('Eve');
    expect(plan.summary).toMatch(/^Eve is leaving: \d+ open tickets to reassign, \d+ pages to review and \d+ systems only they know\.$/);
  });
});
