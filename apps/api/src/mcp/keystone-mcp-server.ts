import { NotFoundException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SearchResponse } from '@keystone/shared';
import { z } from 'zod';
import { PROJECTION_GRAPH } from '../analytics/analytics.constants';
import type { AnalyticsService } from '../analytics/analytics.service';
import { APEX_GRAPH } from '../graph/graph.constants';
import type { WhatIfService } from '../whatif/whatif.service';

/** What the tools call. Nest services in the app; stubs or fixture-bound services in tests. */
export interface KeystoneServices {
  analytics: AnalyticsService;
  retrieval: { search(graphName: string, query: { q: string; k: number }): Promise<SearchResponse> };
  whatIf: Pick<WhatIfService, 'simulateDeparture'>;
}

export interface KeystoneMcpOptions {
  /** The company graph (default apex). */
  graph?: string;
  /** The projection used by bus factor and bridges (default apex_proj). */
  projectionGraph?: string;
}

/** Every tool returns this, as JSON text: the agent cites `evidence`, the UI draws `graphPath`. */
export interface ToolEnvelope<T = unknown> {
  data: T;
  /** Artifact ids that support `data`. */
  evidence: string[];
  graphPath?: { nodes: unknown[]; edges: unknown[] };
}

/** Long lists are cut so one tool result stays a reasonable size for a model. */
const MAX_DECISIONS = 20;
const MAX_LIST_ITEMS = 15;
const MAX_PASSAGE_CHARS = 600;

export const SERVER_INFO = { name: 'keystone', version: '0.1.0' };

/**
 * The Keystone MCP server: graph and search tools over the Apex Athletics
 * knowledge graph. Tools only call Nest services (no Cypher here), and each one
 * answers with the same envelope. A new server per HTTP request (stateless mode);
 * one for the stdio process.
 */
export function createKeystoneMcpServer(services: KeystoneServices, options: KeystoneMcpOptions = {}): McpServer {
  const graph = options.graph ?? APEX_GRAPH;
  const projection = options.projectionGraph ?? PROJECTION_GRAPH;
  const { analytics, retrieval, whatIf } = services;
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'search_knowledge',
    {
      title: 'Search company documents',
      description:
        "Semantic search over Apex Athletics' own documents (Jira tickets, Confluence pages, Slack threads, pull requests, emails, " +
        'meeting transcripts). Returns the best-matching passages, each with its artifact id, title, type, day and the people who ' +
        'wrote it, plus ids of linked artifacts. Use it for what was said or written, the reasons behind a change, and details that ' +
        'only appear in document text. Do not use it to decide who knows a system, who owns what, knowledge risk or the impact of a ' +
        'departure: who_knows, bus_factor, simulate_departure and trace_decision answer those from structured data. Cite the ' +
        'artifactId of every passage you rely on.',
      inputSchema: {
        question: z.string().trim().min(1).max(500).describe('What to look for, in natural language.'),
        k: z.number().int().min(1).max(20).optional().describe('How many passages to return (default 8).'),
      },
    },
    run(async ({ question, k }) => {
      const response = await retrieval.search(graph, { q: question, k: k ?? 8 });
      const hits = response.hits.map((h) => ({
        artifactId: h.artifactId,
        title: h.title,
        type: h.type,
        day: h.day,
        similarity: round(h.similarity, 3),
        text: h.text.length > MAX_PASSAGE_CHARS ? `${h.text.slice(0, MAX_PASSAGE_CHARS)}…` : h.text,
        authors: h.authors,
        related: h.related.slice(0, 5),
      }));
      return { data: { question, hits }, evidence: unique(hits.map((h) => h.artifactId)) };
    }),
  );

  server.registerTool(
    'who_knows',
    {
      title: 'Experts on a system',
      description:
        'Who knows one system best: the five strongest active experts, each with an expertise score, the last day they worked on it ' +
        'and the artifact ids that show it, plus an evidence graph for the top expert. The score is recency-weighted (writing a ' +
        'document about the system counts 3, reviewing 2, owning a ticket 1, taking part in a conversation up to 0.5; older work ' +
        "counts less, halving about every three weeks). Use it for 'who knows X', 'who is the expert on X', 'who should I ask about " +
        "X'. If the name is not a known system, the result has found: false and up to five similar system names: call it again with " +
        "one of them. Not for what happens if someone leaves (use simulate_departure).",
      inputSchema: {
        system: z.string().trim().min(1).max(200).describe('The system name, e.g. "TitanDB" (see list_systems).'),
      },
    },
    run(async ({ system }) => {
      try {
        const result = await analytics.experts(system, graph);
        const experts = result.experts.map((e) => ({ ...e, score: round(e.score, 2) }));
        return {
          data: { system, found: true, experts, topExpert: result.evidencePath?.person ?? null },
          evidence: unique([...experts.flatMap((e) => e.evidence), ...(result.evidencePath?.evidence ?? [])]),
          ...(result.evidencePath ? { graphPath: { nodes: result.evidencePath.nodes, edges: result.evidencePath.edges } } : {}),
        };
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        return { data: { system, found: false, suggestions: await analytics.similarSystems(system, graph) }, evidence: [] };
      }
    }),
  );

  server.registerTool(
    'bus_factor',
    {
      title: 'Knowledge risk per system',
      description:
        "Knowledge risk across the company's core systems (systems named in at least five documents by two or more people): how many " +
        'experts each has and a risk level: orphaned (no expert), critical (one), watch (two) or ok (three or more). An expert scores ' +
        "at least minScore (default 0.4) and at least 25% of the system's top score. Returns the number of systems per level and every " +
        "system that is not ok, with its experts and artifact ids. Use it for 'where are we exposed', 'single points of failure', " +
        "'which systems depend on one person'. For the effect of one person leaving use simulate_departure; for the experts on one " +
        'system use who_knows.',
      inputSchema: {
        minScore: z.number().min(0).max(1000).optional().describe('Lowest expertise score that counts as an expert (default 0.4).'),
      },
    },
    run(async ({ minScore }) => {
      const rows = await analytics.busFactor(minScore, projection);
      const counts = { orphaned: 0, critical: 0, watch: 0, ok: 0 };
      for (const row of rows) counts[row.riskLevel]++;
      const atRisk = rows
        .filter((row) => row.riskLevel !== 'ok')
        .map((row) => ({
          system: row.system,
          riskLevel: row.riskLevel,
          experts: row.names,
          evidence: unique(row.evidence.flatMap((ids) => ids.slice(0, 2))),
        }));
      return { data: { counts, atRisk }, evidence: unique(atRisk.flatMap((row) => row.evidence)) };
    }),
  );

  server.registerTool(
    'bridge_people',
    {
      title: 'People who connect teams',
      description:
        'The ten people who connect otherwise separate groups: betweenness centrality on the collaboration network (people who work ' +
        'on the same documents and conversations), each with their department and recent artifacts they share with other ' +
        "departments as evidence. Use it for 'who connects teams', 'who are our key connectors', 'whose departure would cut " +
        "communication between teams'. It is not a measure of expertise in a system (use who_knows).",
      inputSchema: {},
    },
    run(async () => {
      const bridges = (await analytics.bridges(projection, graph)).map((b) => ({ ...b, score: round(b.score, 1) }));
      return { data: { bridges }, evidence: unique(bridges.flatMap((b) => b.evidence)) };
    }),
  );

  server.registerTool(
    'simulate_departure',
    {
      title: 'What if someone leaves',
      description:
        'Simulates one person leaving without changing any data: removes them from a copy of the expertise graph and compares before ' +
        'and after. Returns the core systems that would lose their last expert (newly orphaned) or be left with exactly one (newly ' +
        "critical), systems nobody would know at all, how the key connectors shift, the person's open tickets with suggested new " +
        'owners, and pages only they wrote, each with artifact ids, plus a graph around the person. Use it for "what if X leaves", ' +
        '"what breaks if X quits", "who could take over X\'s work". The person must be an active employee: check the exact name with ' +
        'list_people; to find the expert on a system first, use who_knows.',
      inputSchema: {
        person: z.string().trim().min(1).max(200).describe('Exact name of an active employee, e.g. "Jax".'),
      },
    },
    run(async ({ person }) => {
      const r = await whatIf.simulateDeparture(person);
      const data = {
        person: r.person,
        dept: r.dept,
        systemsNewlyOrphaned: r.systemsNewlyOrphaned,
        systemsNewlyCritical: r.systemsNewlyCritical,
        islandsCreated: r.islandsCreated,
        bridgeShift: r.bridgeShift.slice(0, 5),
        openTickets: { total: r.orphanedTickets.length, items: r.orphanedTickets.slice(0, MAX_LIST_ITEMS) },
        soleAuthoredPages: { total: r.soleAuthoredPages.length, items: r.soleAuthoredPages.slice(0, MAX_LIST_ITEMS) },
      };
      const evidence = unique([
        ...data.systemsNewlyOrphaned.flatMap((c) => c.evidence),
        ...data.systemsNewlyCritical.flatMap((c) => c.evidence),
        ...data.islandsCreated.flatMap((i) => i.evidence),
        ...data.bridgeShift.flatMap((b) => b.evidence),
        ...data.openTickets.items.flatMap((t) => [...t.evidence, ...t.ownerEvidence.flat()]),
        ...data.soleAuthoredPages.items.flatMap((p) => p.evidence),
      ]);
      return { data, evidence, graphPath: { nodes: r.graph.nodes, edges: r.graph.edges } };
    }),
  );

  server.registerTool(
    'trace_decision',
    {
      title: 'Decision history of a system',
      description:
        "The decision history of one system, newest first: each decision's summary, day, kind (adopt, deprecate, change, policy), " +
        'status (active or superseded), the artifact it was made in with its type and the people involved, and the earlier decision ' +
        `it replaced, if any. Returns at most the ${MAX_DECISIONS} most recent decisions and the total count. Use it for 'why did we ` +
        "choose X', 'when did we change X', 'what was decided about X'. If the system is unknown the result has found: false and up " +
        'to five similar names. For the wording of the discussion behind a decision, follow up with search_knowledge on its source.',
      inputSchema: {
        system: z.string().trim().min(1).max(200).describe('The system name, e.g. "Kafka" (see list_systems).'),
      },
    },
    run(async ({ system }) => {
      try {
        const rows = await analytics.decisions(system, graph);
        const decisions = rows.slice(0, MAX_DECISIONS);
        return {
          data: { system, found: true, total: rows.length, decisions },
          evidence: unique(decisions.map((d) => d.source)),
        };
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        return { data: { system, found: false, suggestions: await analytics.similarSystems(system, graph) }, evidence: [] };
      }
    }),
  );

  server.registerTool(
    'find_stale_docs',
    {
      title: 'Out-of-date documentation',
      description:
        'Confluence pages that still state a decision which a later decision replaced, i.e. documentation that is out of date. Each ' +
        'comes with the outdated claim, the current decision, the day and artifact it was made in, and artifact ids. Use it for ' +
        "'which docs are out of date', 'stale documentation', 'which pages need updating'. An empty list means no page is known to " +
        'contradict a newer decision.',
      inputSchema: {},
    },
    run(async () => {
      const pages = await analytics.staleDocs(graph);
      return {
        data: { pages },
        evidence: unique(pages.flatMap((p) => [p.stalePage, ...(p.decidedIn ? [p.decidedIn] : [])])),
      };
    }),
  );

  server.registerTool(
    'list_systems',
    {
      title: 'Core systems',
      description:
        "The core systems of Apex Athletics (named in at least five documents by two or more people), most mentioned first, with how " +
        'many documents mention each. Use it to find the exact name of a system before calling who_knows or trace_decision, or to ' +
        "answer 'what systems do we run'. Minor systems that are not listed still work with who_knows and trace_decision, which " +
        'suggest close names when a name is not found.',
      inputSchema: {},
    },
    run(async () => ({ data: { systems: await analytics.listCoreSystems(graph) }, evidence: [] })),
  );

  server.registerTool(
    'list_people',
    {
      title: 'People',
      description:
        'Everyone at Apex Athletics with their department, whether they are active, the last day they were seen working and their ' +
        'announced departure day, if any. Set activeOnly to true to leave out people who have left. Use it to check the exact spelling ' +
        "of a person's name before simulate_departure, or to answer who works in which department.",
      inputSchema: {
        activeOnly: z.boolean().optional().describe('Only people who have not left (default false).'),
      },
    },
    run(async ({ activeOnly }) => ({ data: { people: await analytics.listPeople(activeOnly ?? false, graph) }, evidence: [] })),
  );

  // Actions that a human approves: not built yet, registered so clients can see them coming.
  const notYet = (what: string) =>
    run(async () => ({ data: { status: 'not_implemented', message: `${what} is implemented in Stage 11.` }, evidence: [] }));
  server.registerTool(
    'draft_handover',
    {
      title: 'Draft a handover plan (not available yet)',
      description:
        'Not available yet: will draft a handover plan for a person who is leaving, for a human to approve. Calling it now only returns ' +
        'a not_implemented status; for the impact of a departure use simulate_departure.',
      inputSchema: { person: z.string().trim().min(1).max(200).describe('Exact name of the person leaving.') },
    },
    notYet('draft_handover'),
  );
  server.registerTool(
    'propose_reassignment',
    {
      title: 'Propose a ticket reassignment (not available yet)',
      description:
        'Not available yet: will propose reassigning a ticket to a person, with a reason, for a human to approve. Calling it now only ' +
        'returns a not_implemented status; simulate_departure already suggests owners for orphaned tickets.',
      inputSchema: {
        ticketId: z.string().trim().min(1).max(100).describe('The ticket id, e.g. "ENG-100".'),
        person: z.string().trim().min(1).max(200).describe('Who should take the ticket.'),
        reason: z.string().trim().min(1).max(1000).describe('Why this person.'),
      },
    },
    notYet('propose_reassignment'),
  );
  server.registerTool(
    'create_runbook_task',
    {
      title: 'Create a runbook task (not available yet)',
      description:
        'Not available yet: will create a task to write or update the runbook of a system, for a human to approve. Calling it now ' +
        'only returns a not_implemented status.',
      inputSchema: { system: z.string().trim().min(1).max(200).describe('The system that needs a runbook.') },
    },
    notYet('create_runbook_task'),
  );

  return server;
}

/**
 * Wraps a handler: its envelope becomes JSON text; a thrown error becomes an MCP
 * tool error (isError) carrying the same envelope shape with the message, so the
 * model can read what went wrong and try something else.
 */
function run<A>(handler: (args: A) => Promise<ToolEnvelope>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ data: null, evidence: [], error: message }) }] };
    }
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
