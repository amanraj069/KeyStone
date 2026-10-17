import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SearchResponse } from '@keystone/shared';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import type { TextStore } from '../src/ingest/text-store';
import { createKeystoneMcpServer, type ToolEnvelope } from '../src/mcp/keystone-mcp-server';
import { ProjectionService } from '../src/projection/projection.service';
import { WhatIfService } from '../src/whatif/whatif.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';

/**
 * Every Keystone MCP tool through a real MCP client and server (in-memory
 * transport) on the mini-company fixture. search_knowledge uses a stub retrieval:
 * the fixture has no embedded chunks.
 */
describe('Keystone MCP server on the fixture graph', () => {
  const projection = () => `${fx.name}_proj`;
  // Before useFixtureGraph, so it runs while the connection is open.
  afterAll(async () => {
    await client.close();
    for (const g of (await fx.graph.listGraphs()).filter((n) => n.startsWith(`${fx.name}_`))) await fx.graph.deleteGraph(g);
  });
  const fx = useFixtureGraph();
  let client: Client;

  // A fake ActionsService that also HAS approve and reject, to prove the tools never reach them.
  const action = (kind: 'reassign' | 'runbook' | 'handover', target: string) => ({
    id: 'act-0123456789ab', kind, status: 'proposed' as const, day: 12, reason: 'r', summary: null, createdBy: 'keystone', createdAt: 1,
    approvedAt: null, rejectedAt: null, rejectReason: null, targetType: 'Ticket', target, targetTitle: null, assignee: 'Ada',
    planId: null, children: [], evidence: [{ id: 'P-1', title: 'PaymentsAPI runbook', type: 'confluence' }],
  });
  const actions = {
    draftHandover: jest.fn(async () => ({ plan: action('handover', 'Ada'), created: true, children: [action('runbook', 'PaymentsAPI')], skipped: [] })),
    proposeReassignment: jest.fn(async () => ({ action: action('reassign', 'T-4'), created: true })),
    createRunbookTask: jest.fn(async () => ({ action: action('runbook', 'PaymentsAPI'), created: true })),
    approve: jest.fn(),
    reject: jest.fn(),
  };

  const stubSearch: SearchResponse = {
    query: 'q',
    mode: 'hybrid',
    k: 2,
    embedMs: 0,
    searchMs: 1,
    hits: [
      { chunkId: 'P-1#0', artifactId: 'P-1', title: 'PaymentsAPI runbook', type: 'confluence', day: 2, distance: 0.1, similarity: 0.9, text: 'Refunds go through PaymentsAPI.', related: ['TH-1'], authors: ['Ada'] },
      { chunkId: 'TH-1#0', artifactId: 'TH-1', title: 'PaymentsAPI refund bug', type: 'slack', day: 6, distance: 0.2, similarity: 0.8, text: 'Ada: fixed the refund bug.', related: [], authors: ['Ada'] },
    ],
  };

  // Bodies for the text filter: only TH-2 mentions a customer.
  const bodies: Record<string, string> = { 'TH-2': 'Cara: the LegacyAuth session expiry is hitting Metro United FC logins again.' };
  const textStore: TextStore = {
    put: async () => undefined,
    get: async (_kind, id) => bodies[id] ?? null,
    getMany: async (_kind, ids) => new Map(ids.flatMap((id) => (bodies[id] ? [[id, bodies[id]] as const] : []))),
  };
  const search = jest.fn(async () => stubSearch);

  beforeAll(async () => {
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 });
    // Links between artifacts (the fixture has none): PR-1 fixes T-1, T-2 references T-1.
    await fx.graph.query(fx.name, "MATCH (pr:Artifact {id: 'PR-1'}), (t:Artifact {id: 'T-1'}) CREATE (pr)-[:FIXES]->(t)");
    await fx.graph.query(fx.name, "MATCH (a:Artifact {id: 'T-2'}), (t:Artifact {id: 'T-1'}) CREATE (a)-[:REFERENCES {kind: 'jira'}]->(t)");
    // Eve received the TH-2 thread (no role on it): a visibility edge only.
    await fx.graph.query(fx.name, "MATCH (p:Person {name: 'Eve'}), (a:Artifact {id: 'TH-2'}) CREATE (p)-[:RECEIVED {day: 8}]->(a)");
    await new ProjectionService(fx.graph).rebuild(projection(), { sourceGraph: fx.name });
    const analytics = new AnalyticsService(fx.graph);
    const whatIf = new WhatIfService(fx.graph, analytics, new ProjectionService(fx.graph), {
      maxConcurrent: 2,
      sourceGraph: fx.name,
      projectionGraph: projection(),
      scratchPrefix: `${fx.name}_whatif_`,
    });
    const server = createKeystoneMcpServer(
      { analytics, whatIf, retrieval: { search }, actions, artifacts: new ArtifactsService(fx.graph, textStore) },
      { graph: fx.name, projectionGraph: projection() },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'keystone-test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  /** Calls a tool and parses the JSON envelope from its single text block. */
  async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    return { isError: result.isError === true, envelope: JSON.parse(content[0].text) as ToolEnvelope<T> & { error?: string } };
  }

  /** The envelope every tool returns: data, evidence (artifact ids) and optionally graphPath. */
  function expectEnvelope(envelope: ToolEnvelope, withGraph = false): void {
    expect(Object.keys(envelope).sort()).toEqual(withGraph ? ['data', 'evidence', 'graphPath'] : ['data', 'evidence']);
    expect(Array.isArray(envelope.evidence)).toBe(true);
    envelope.evidence.forEach((id) => expect(typeof id).toBe('string'));
    expect(new Set(envelope.evidence).size).toBe(envelope.evidence.length);
    if (withGraph) {
      expect(Array.isArray(envelope.graphPath!.nodes)).toBe(true);
      expect(Array.isArray(envelope.graphPath!.edges)).toBe(true);
    }
  }

  it('lists every tool with a description and an input schema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'bridge_people', 'bus_factor', 'check_causal_link', 'check_follow_up', 'check_involvement', 'check_visibility', 'create_runbook_task',
      'draft_handover', 'find_artifacts', 'find_event', 'find_stale_docs', 'get_artifact', 'list_people', 'list_systems',
      'propose_reassignment', 'search_knowledge', 'simulate_departure', 'trace_decision', 'what_followed', 'who_knows',
    ]);
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe('object');
    }
    expect(tools.find((t) => t.name === 'who_knows')!.inputSchema.required).toEqual(['system']);
  });

  it('search_knowledge: passages with their artifact ids as evidence', async () => {
    const { envelope } = await call<{ hits: { artifactId: string; text: string }[] }>('search_knowledge', { question: 'refunds', k: 2 });
    expectEnvelope(envelope);
    expect(envelope.data.hits.map((h) => h.artifactId)).toEqual(['P-1', 'TH-1']);
    expect(envelope.evidence).toEqual(['P-1', 'TH-1']);
  });

  it('search_knowledge: passes a day range on (toDay as asOfDay)', async () => {
    await call('search_knowledge', { question: 'refunds', fromDay: 3, toDay: 9 });
    expect(search).toHaveBeenLastCalledWith(fx.name, { q: 'refunds', k: 8, fromDay: 3, asOfDay: 9 });
  });

  type Found = { artifacts: { id: string; day: number; people: { name: string; role: string }[]; snippet?: string }[]; more: boolean };

  it('find_artifacts (FIND_ARTIFACTS): by people and days, oldest first, with everyone involved and their role', async () => {
    const { envelope } = await call<Found>('find_artifacts', { people: ['Ada'], fromDay: 3, toDay: 7 });
    expectEnvelope(envelope);
    expect(envelope.data.artifacts.map((a) => a.id)).toEqual(['T-1', 'PR-1', 'TH-1', 'T-2']);
    expect(envelope.evidence).toEqual(['T-1', 'PR-1', 'TH-1', 'T-2']);
    expect(envelope.data.artifacts[0].people).toEqual(expect.arrayContaining([{ name: 'Ada', role: 'authored' }, { name: 'Ben', role: 'assigned' }]));
  });

  it('find_artifacts: by type and by title, and more people involved ranks first', async () => {
    const prs = await call<Found>('find_artifacts', { types: ['pr'] });
    expect(prs.envelope.data.artifacts.map((a) => a.id)).toEqual(['PR-1', 'PR-2', 'PR-3']);
    const titan = await call<Found>('find_artifacts', { titleContains: 'TITANDB', limit: 2 });
    expect(titan.envelope.data).toMatchObject({ more: true });
    expect(titan.envelope.data.artifacts.map((a) => a.id)).toEqual(['T-1', 'PR-1']);
    const both = await call<Found>('find_artifacts', { people: ['Ada', 'Ben'], fromDay: 1, toDay: 12 });
    expect(both.envelope.data.artifacts.slice(0, 2).map((a) => a.id)).toEqual(['T-1', 'PR-1']);
  });

  it('find_artifacts: text in the body within a day range, with a snippet; refuses unbounded text and no filter', async () => {
    const { envelope } = await call<Found>('find_artifacts', { textContains: 'metro united', fromDay: 6, toDay: 10 });
    expect(envelope.data.artifacts.map((a) => a.id)).toEqual(['TH-2']);
    expect(envelope.data.artifacts[0].snippet).toContain('Metro United FC');
    expect((await call('find_artifacts', { textContains: 'metro' })).isError).toBe(true);
    expect((await call('find_artifacts', {})).isError).toBe(true);
  });

  it('get_artifact (ARTIFACT_PEOPLE, ARTIFACT_LINKS): people with roles and links in both directions', async () => {
    const { envelope } = await call<{ people: { name: string; roles: string[] }[]; links: { id: string; link: string; direction: string }[] }>(
      'get_artifact',
      { id: 'T-1' },
    );
    expectEnvelope(envelope);
    expect(envelope.data.people).toEqual([
      { name: 'Ada', roles: ['authored'], day: 3 },
      { name: 'Ben', roles: ['assigned'], day: 3 },
    ]);
    expect(envelope.data.links).toEqual([
      expect.objectContaining({ id: 'PR-1', link: 'FIXES', direction: 'in' }),
      expect.objectContaining({ id: 'T-2', link: 'REFERENCES', kind: 'jira', direction: 'in' }),
    ]);
    expect(envelope.evidence).toEqual(['T-1', 'PR-1', 'T-2']);
    expect((await call('get_artifact', { id: 'NOPE-1' })).isError).toBe(true);
  });

  it('what_followed (WHAT_FOLLOWED): linked artifacts first, then those sharing people, within the window', async () => {
    const { envelope } = await call<{ followed: { id: string; linked: boolean; shared: string[] }[] }>('what_followed', { id: 'T-1', days: 6 });
    expectEnvelope(envelope);
    const ids = envelope.data.followed.map((f) => f.id);
    expect(ids.slice(0, 2)).toEqual(['PR-1', 'T-2']);
    expect(envelope.data.followed[0]).toMatchObject({ linked: true, shared: expect.arrayContaining(['Ada', 'Ben']) });
    expect(ids).toEqual(expect.arrayContaining(['TH-1', 'PR-2']));
    expect(ids).not.toContain('P-1'); // day 2: before T-1
    expect(ids).not.toContain('T-4'); // day 11: after the window
    expect(envelope.evidence[0]).toBe('T-1');
  });

  it('what_followed: nothing in the window still cites the starting artifact; a dayless one is refused', async () => {
    const { envelope } = await call<{ followed: unknown[] }>('what_followed', { id: 'P-3', days: 3, types: ['email'] });
    expect(envelope.data.followed).toEqual([]);
    expect(envelope.evidence).toEqual(['P-3']);
    expect((await call('what_followed', { id: 'P-2' })).isError).toBe(true);
  });

  it('find_event (FIND_EVENT_CANDIDATES): ranks the window by people, title words, text words and day distance', async () => {
    const { envelope } = await call<{ fromDay: number; toDay: number; words: string[]; candidates: { id: string; matched: number; titleWords: string[] }[] }>(
      'find_event',
      { day: 4, people: ['Ben'], description: 'the connection pool fix' },
    );
    expectEnvelope(envelope);
    expect(envelope.data).toMatchObject({ fromDay: 2, toDay: 6, words: ['connection', 'pool', 'fix'] });
    expect(envelope.data.candidates[0]).toMatchObject({ id: 'PR-1', matched: 1, titleWords: ['connection', 'pool', 'fix'] });
    // A name only in the text (a customer) is found through the body.
    const text = await call<{ candidates: { id: string; textWords: string[] }[] }>('find_event', { day: 8, description: 'Metro United' });
    expect(text.envelope.data.candidates[0]).toMatchObject({ id: 'TH-2', textWords: ['metro', 'united'] });
  });

  it('check_follow_up (CHECK_FOLLOW_UP): linked responses of the kind asked, else followed: false citing the start', async () => {
    type FollowUp = { followed: boolean; responses: { id: string; hops: number }[] };
    const pr = await call<FollowUp>('check_follow_up', { id: 'T-1', kind: 'pull_request' });
    expect(pr.envelope.data).toMatchObject({ followed: true, responses: [{ id: 'PR-1', hops: 1 }] });
    expect(pr.envelope.evidence).toEqual(['T-1', 'PR-1']);
    const ticket = await call<FollowUp>('check_follow_up', { id: 'T-1', kind: 'ticket', days: 10 });
    expect(ticket.envelope.data.responses.map((r) => r.id)).toEqual(['T-2']);
    const postmortem = await call<FollowUp>('check_follow_up', { id: 'T-1', kind: 'postmortem' });
    expect(postmortem.envelope.data).toMatchObject({ followed: false, responses: [] });
    expect(postmortem.envelope.evidence).toEqual(['T-1']);
  });

  it('check_involvement (CHECK_INVOLVEMENT): direct roles by a day, received counts, otherwise involved: false', async () => {
    type Involvement = { involved: boolean; onlyViaLinked: boolean; artifacts: { id: string; roles: string[]; viaLinked: string[] }[]; unknownIds: string[] };
    const ben = await call<Involvement>('check_involvement', { person: 'Ben', ids: ['T-1'], asOfDay: 3 });
    expect(ben.envelope.data).toMatchObject({ involved: true, artifacts: [{ id: 'T-1', roles: ['assigned'] }] });
    const eve = await call<Involvement>('check_involvement', { person: 'Eve', ids: ['TH-2'] });
    expect(eve.envelope.data).toMatchObject({ involved: true, artifacts: [{ id: 'TH-2', roles: ['received'] }] });
    const early = await call<Involvement>('check_involvement', { person: 'Eve', ids: ['TH-2'], asOfDay: 5 });
    expect(early.envelope.data.involved).toBe(false);
    // Dev never touched T-1 or the documents linked to it; an id that does not exist is reported, not used as evidence.
    const dev = await call<Involvement>('check_involvement', { person: 'Dev', ids: ['T-1', 'NOPE-1'] });
    expect(dev.envelope.data).toMatchObject({ involved: false, onlyViaLinked: false, unknownIds: ['NOPE-1'] });
    expect(dev.envelope.evidence).toEqual(['T-1']);
    expect((await call('check_involvement', { person: 'Nobody', ids: ['T-1'] })).isError).toBe(true);
  });

  it('check_causal_link (CHECK_CAUSAL_LINK, EXISTING_ARTIFACT_IDS): shortest chain, or linked: false; never a made-up id as evidence', async () => {
    type Causal = { verdict: string; linked: boolean; links: { cause: string; effect: string; via: string[]; kinds: string[] }[]; unknownIds: string[] };
    const direct = await call<Causal>('check_causal_link', { causes: ['T-1'], effects: ['T-2'] });
    expect(direct.envelope.data).toMatchObject({ linked: true, links: [{ cause: 'T-1', effect: 'T-2', via: ['T-1', 'T-2'], kinds: ['jira'] }] });
    const twoHops = await call<Causal>('check_causal_link', { causes: ['PR-1'], effects: ['T-2'] });
    expect(twoHops.envelope.data.links[0].via).toEqual(['PR-1', 'T-1', 'T-2']);
    expect(direct.envelope.data.verdict).toBe('linked');
    // Not linked, but T-1 came a day after P-1 and Ada is in both (CAUSAL_PROXIMITY): likely.
    const near = await call<Causal & { verdict: string; proximity: { daysApart: number; shared: string[] }[] }>('check_causal_link', { causes: ['P-1', 'NOPE-9'], effects: ['T-1'] });
    expect(near.envelope.data).toMatchObject({ verdict: 'likely', linked: false, links: [], unknownIds: ['NOPE-9'], proximity: [{ daysApart: 1, shared: ['Ada'] }] });
    expect(near.envelope.evidence).toEqual(['P-1', 'T-1']);
    // Nobody in common and no link: no_evidence.
    const none = await call<{ verdict: string }>('check_causal_link', { causes: ['P-3'], effects: ['TH-2'] });
    expect(none.envelope.data.verdict).toBe('no_evidence');
  });

  it('check_visibility: finds the event without the person asked about, then checks their involvement by that day', async () => {
    type Visibility = { verdict: string; event: { id: string } | null; roles: string[] };
    const ada = await call<Visibility>('check_visibility', { person: 'Ada', day: 4, description: 'the connection pool fix' });
    expectEnvelope(ada.envelope);
    expect(ada.envelope.data).toMatchObject({ verdict: 'could_have_known', event: { id: 'PR-1' }, roles: ['reviewed'] });
    const dev = await call<Visibility>('check_visibility', { person: 'Dev', day: 4, description: 'the connection pool fix' });
    expect(dev.envelope.data).toMatchObject({ verdict: 'no_record_of_involvement', event: { id: 'PR-1' } });
    // The person asked about is dropped from eventPeople, so they cannot steer the search to their own documents.
    const steered = await call<Visibility>('check_visibility', { person: 'Dev', day: 4, description: 'the connection pool fix', eventPeople: ['Dev'] });
    expect(steered.envelope.data.event?.id).toBe('PR-1');
    // A quoted title is looked up first.
    const titled = await call<Visibility>('check_visibility', { person: 'Cara', day: 7, description: 'backup', title: 'TitanDB backup job' });
    expect(titled.envelope.data).toMatchObject({ verdict: 'could_have_known', event: { id: 'T-2' }, roles: ['assigned'] });
  });

  it('who_knows: experts with evidence and an evidence graph', async () => {
    const { envelope } = await call<{ found: boolean; experts: { person: string; evidence: string[] }[] }>('who_knows', { system: 'TitanDB' });
    expectEnvelope(envelope, true);
    expect(envelope.data.found).toBe(true);
    expect(envelope.data.experts[0].person).toBe('Ada');
    expect(envelope.evidence).toEqual(expect.arrayContaining(['T-1', 'T-2']));
    expect(envelope.graphPath!.nodes.length).toBeGreaterThan(0);
  });

  it('who_knows: an unknown name returns similar system names to retry with', async () => {
    const { isError, envelope } = await call<{ found: boolean; suggestions: string[] }>('who_knows', { system: 'Titan-DB2' });
    expect(isError).toBe(false);
    expectEnvelope(envelope);
    expect(envelope.data).toMatchObject({ found: false });
    expect(envelope.data.suggestions[0]).toBe('TitanDB');
  });

  it('bus_factor: counts per risk level and the systems at risk', async () => {
    const { envelope } = await call<{ counts: Record<string, number>; atRisk: { system: string; riskLevel: string }[] }>('bus_factor', { minScore: 0.05 });
    expectEnvelope(envelope);
    expect(envelope.data.counts).toEqual({ orphaned: 1, critical: 1, watch: 1, ok: 1 });
    expect(envelope.data.atRisk.map((r) => [r.system, r.riskLevel])).toEqual([
      ['LegacyAuth', 'orphaned'],
      ['PaymentsAPI', 'critical'],
      ['TitanDB', 'watch'],
    ]);
  });

  it('bridge_people: betweenness ranking with cross-department evidence', async () => {
    const { envelope } = await call<{ bridges: { person: string }[] }>('bridge_people');
    expectEnvelope(envelope);
    expect(envelope.data.bridges[0].person).toBe('Dev');
    expect(envelope.evidence.length).toBeGreaterThan(0);
  });

  it('simulate_departure: the what-if diff, evidence and the graph to animate', async () => {
    const { envelope } = await call<{ systemsNewlyOrphaned: { system: string }[] }>('simulate_departure', { person: 'Ada' });
    expectEnvelope(envelope, true);
    expect(envelope.data.systemsNewlyOrphaned.map((c) => c.system)).toEqual(['PaymentsAPI']);
    expect(envelope.evidence).toEqual(expect.arrayContaining(['P-1', 'TH-1']));
  });

  it('simulate_departure: a departed person is a tool error with the same envelope', async () => {
    const { isError, envelope } = await call('simulate_departure', { person: 'Cara' });
    expect(isError).toBe(true);
    expect(envelope).toMatchObject({ data: null, evidence: [], error: expect.stringContaining('not active') });
  });

  it('trace_decision: decisions with their source artifacts', async () => {
    const { envelope } = await call<{ found: boolean; total: number; decisions: { id: string; source: string }[] }>('trace_decision', { system: 'MobileApp' });
    expectEnvelope(envelope);
    expect(envelope.data).toMatchObject({ found: true, total: 1 });
    expect(envelope.data.decisions[0]).toMatchObject({ id: 'D-2', source: 'M-1' });
    expect(envelope.evidence).toEqual(['M-1']);
  });

  it('find_stale_docs: the page that asserts a superseded decision', async () => {
    const { envelope } = await call<{ pages: { stalePage: string }[] }>('find_stale_docs');
    expectEnvelope(envelope);
    expect(envelope.data.pages.map((p) => p.stalePage)).toEqual(['P-3']);
    expect(envelope.evidence).toEqual(['P-3', 'M-1']);
  });

  it('list_systems and list_people: names the model can use', async () => {
    const systems = await call<{ systems: { name: string }[] }>('list_systems');
    expectEnvelope(systems.envelope);
    expect(systems.envelope.data.systems.map((s) => s.name).sort()).toEqual(['LegacyAuth', 'MobileApp', 'PaymentsAPI', 'TitanDB']);
    const active = await call<{ people: { name: string }[] }>('list_people', { activeOnly: true });
    expect(active.envelope.data.people.map((p) => p.name)).toEqual(['Ada', 'Ben', 'Dev', 'Eve']);
    const everyone = await call<{ people: { name: string }[] }>('list_people');
    expect(everyone.envelope.data.people).toHaveLength(5);
  });

  it('the action tools only create proposals: approve and reject are not tools and are never called', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).filter((n) => /approve|reject/.test(n))).toEqual([]);
    for (const name of ['draft_handover', 'propose_reassignment', 'create_runbook_task']) {
      expect(tools.find((t) => t.name === name)!.description).toContain('Approving or rejecting is not available as a tool');
    }

    const handover = await call<{ created: boolean; plan: { kind: string }; actionsByKind: Record<string, number> }>('draft_handover', { person: 'Ada' });
    expectEnvelope(handover.envelope);
    expect(handover.envelope.data).toMatchObject({ created: true, plan: { kind: 'handover' }, actionsByKind: { runbook: 1 } });
    const reassign = await call<{ action: { status: string } }>('propose_reassignment', { ticketId: 'T-4', person: 'Ada', reason: 'knows TitanDB' });
    expect(reassign.envelope.data.action.status).toBe('proposed');
    expect(reassign.envelope.evidence).toEqual(['P-1']);
    await call('create_runbook_task', { system: 'PaymentsAPI' });

    expect(actions.draftHandover).toHaveBeenCalledWith('Ada');
    expect(actions.proposeReassignment).toHaveBeenCalledWith('T-4', 'Ada', 'knows TitanDB');
    expect(actions.createRunbookTask).toHaveBeenCalledWith('PaymentsAPI');
    expect(actions.approve).not.toHaveBeenCalled();
    expect(actions.reject).not.toHaveBeenCalled();

    // An approve tool does not exist, so a client asking for one gets an error.
    const attempt = await client.callTool({ name: 'approve_action', arguments: { id: 'act-0123456789ab' } });
    expect(attempt.isError).toBe(true);
  });

  it('rejects invalid arguments before calling any service', async () => {
    const result = await client.callTool({ name: 'who_knows', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
