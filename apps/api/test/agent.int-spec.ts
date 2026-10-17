import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SearchResponse } from '@keystone/shared';
import { AgentService } from '../src/agent/agent.service';
import type { AgentEvent, AgentModel, ModelTurn } from '../src/agent/agent.types';
import { McpToolClient } from '../src/agent/mcp-tool-client';
import { toOpenAiTools } from '../src/agent/tool-specs';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import type { TextStore } from '../src/ingest/text-store';

const noText: TextStore = { put: async () => undefined, get: async () => null, getMany: async () => new Map() };
import { createKeystoneMcpServer } from '../src/mcp/keystone-mcp-server';
import { ProjectionService } from '../src/projection/projection.service';
import { WhatIfService } from '../src/whatif/whatif.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';

/**
 * The agent's plumbing on the fixture: tools listed from the Keystone MCP server
 * (in-memory transport) and called through MCP, citations looked up in the graph.
 * The model is scripted.
 */
describe('Agent with the Keystone MCP server on the fixture graph', () => {
  const projection = () => `${fx.name}_proj`;
  afterAll(async () => {
    await tools.close();
    for (const g of (await fx.graph.listGraphs()).filter((n) => n.startsWith(`${fx.name}_`))) await fx.graph.deleteGraph(g);
  });
  const fx = useFixtureGraph();
  let tools: McpToolClient;
  let connections = 0;

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
    const search = async (): Promise<SearchResponse> => ({ query: 'q', mode: 'hybrid', k: 1, embedMs: 0, searchMs: 0, hits: [] });
    tools = new McpToolClient(() => {
      connections++;
      const [client, server] = InMemoryTransport.createLinkedPair();
      const actions = { draftHandover: jest.fn(), proposeReassignment: jest.fn(), createRunbookTask: jest.fn() };
      void createKeystoneMcpServer({ analytics, whatIf, retrieval: { search }, actions, artifacts: new ArtifactsService(fx.graph, noText) }, { graph: fx.name, projectionGraph: projection() }).connect(server);
      return client;
    });
  });

  it('lists the MCP tools once and turns them into function declarations', async () => {
    const specs = await tools.list();
    await tools.list();
    expect(connections).toBe(1);
    expect(specs.map((s) => s.name)).toContain('who_knows');
    const whoKnows = toOpenAiTools(specs).find((t) => t.function.name === 'who_knows')!;
    expect(whoKnows.function.parameters).toMatchObject({ type: 'object', properties: { system: { type: 'string' } }, required: ['system'] });
    expect(whoKnows.function.description).toContain('Who knows one system best');
  });

  it('answers through a real tool call, keeps only real evidence, and looks citations up in the graph', async () => {
    const turns: ModelTurn[] = [
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'TitanDB' } }] },
      { text: 'Ada knows TitanDB best [T-1, T-2]. She also owns [NOT-A-REAL-ID].', toolCalls: [] },
    ];
    let n = 0;
    const model: AgentModel = { provider: 'scripted', model: 'test', step: async () => turns[n++] };
    const llm = { generateObjectWithUsage: async () => ({ value: { label: 'who_knows' }, usage: {}, cached: true }) };
    const agent = new AgentService(model, tools, llm as never, fx.graph, { graph: fx.name, maxSteps: 5, budgetMs: 60_000, finalAnswerGraceMs: 20_000 });
    const events: AgentEvent[] = [];
    for await (const event of agent.run('Who knows TitanDB best?', 'test')) events.push(event);

    const result = events.find((e) => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.summary).toBe('experts: 3');
    expect(result.graphPath?.nodes.length).toBeGreaterThan(0);
    const answer = events.flatMap((e) => (e.type === 'answer_delta' ? [e.text] : [])).join('');
    expect(answer).toBe('Ada knows TitanDB best [T-1, T-2]. She also owns.');
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.citations).toEqual([
      { id: 'T-1', title: 'TitanDB latency spike', type: 'jira', day: 3 },
      { id: 'T-2', title: 'TitanDB backup job', type: 'jira', day: 7 },
    ]);
  });
});
