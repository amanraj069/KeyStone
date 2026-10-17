import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SearchResponse } from '@keystone/shared';
import { AnalyticsService } from '../src/analytics/analytics.service';
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
    const server = createKeystoneMcpServer(
      { analytics, whatIf, retrieval: { search: async () => stubSearch } },
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
      'bridge_people', 'bus_factor', 'create_runbook_task', 'draft_handover', 'find_stale_docs', 'list_people',
      'list_systems', 'propose_reassignment', 'search_knowledge', 'simulate_departure', 'trace_decision', 'who_knows',
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

  it('the action tools are stubs for now', async () => {
    for (const [name, args] of [
      ['draft_handover', { person: 'Ada' }],
      ['propose_reassignment', { ticketId: 'T-4', person: 'Ben', reason: 'knows TitanDB' }],
      ['create_runbook_task', { system: 'PaymentsAPI' }],
    ] as const) {
      const { envelope } = await call<{ status: string; message: string }>(name, args);
      expectEnvelope(envelope);
      expect(envelope.data).toEqual({ status: 'not_implemented', message: `${name} is implemented in Stage 11.` });
    }
  });

  it('rejects invalid arguments before calling any service', async () => {
    const result = await client.callTool({ name: 'who_knows', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
