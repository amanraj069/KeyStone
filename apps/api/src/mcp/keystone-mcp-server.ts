import { NotFoundException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SearchResponse } from '@keystone/shared';
import { z } from 'zod';
import { PROJECTION_GRAPH } from '../analytics/analytics.constants';
import type { ActionRow, ActionsService } from '../actions/actions.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import {
  ARTIFACT_TYPES,
  type ArtifactsService,
  CAUSAL_PROXIMITY_DAYS,
  EVENT_MAX_TOLERANCE,
  FIND_MAX_LIMIT,
  FOLLOW_MAX_DAYS,
  FOLLOW_UP_DEFAULT_DAYS,
  FOLLOW_UP_KIND_NAMES,
  TEXT_SCAN_MAX_DAYS,
} from '../artifacts/artifacts.service';
import { APEX_GRAPH } from '../graph/graph.constants';
import type { MemoryService } from '../memory/memory.service';
import type { WhatIfService } from '../whatif/whatif.service';

/** What the tools call. Nest services in the app; stubs or fixture-bound services in tests. */
export interface KeystoneServices {
  analytics: AnalyticsService;
  retrieval: { search(graphName: string, query: { q: string; k: number; fromDay?: number; asOfDay?: number }): Promise<SearchResponse> };
  /** Artifacts by day, people, type, title and links (the event tools). */
  artifacts: Pick<ArtifactsService, 'find' | 'context' | 'whatFollowed' | 'findEvent' | 'checkFollowUp' | 'checkInvolvement' | 'checkCausalLink' | 'checkVisibility'>;
  whatIf: Pick<WhatIfService, 'simulateDeparture'>;
  /**
   * Only the methods that PROPOSE. approve and reject are deliberately not part of
   * this type, so no MCP tool (and no agent) can approve its own proposals.
   */
  actions: Pick<ActionsService, 'draftHandover' | 'proposeReassignment' | 'createRunbookTask'>;
  /** Recall only (the recall_memory tool); notes are approved by people, never through MCP. Optional. */
  memory?: Pick<MemoryService, 'recall'>;
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
  const { analytics, retrieval, whatIf, actions, artifacts } = services;
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
        'departure: who_knows, bus_factor, simulate_departure and trace_decision answer those from structured data. Text search ' +
        'does not understand day numbers or names well: when the question names a day, pass fromDay/toDay, and to find what ' +
        'specific people did on given days use find_artifacts instead. Cite the artifactId of every passage you rely on.',
      inputSchema: {
        question: z.string().trim().min(1).max(500).describe('What to look for, in natural language.'),
        k: z.number().int().min(1).max(20).optional().describe('How many passages to return (default 8).'),
        fromDay: z.number().int().min(0).max(1000).optional().describe('Only documents from this day number on.'),
        toDay: z.number().int().min(0).max(1000).optional().describe('Only documents up to this day number.'),
      },
    },
    run(async ({ question, k, fromDay, toDay }) => {
      const response = await retrieval.search(graph, { q: question, k: k ?? 8, ...(fromDay !== undefined ? { fromDay } : {}), ...(toDay !== undefined ? { asOfDay: toDay } : {}) });
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
    'find_artifacts',
    {
      title: 'Find documents by day, people, type or title',
      description:
        'Finds documents (tickets, pages, Slack threads, pull requests, emails, meetings, alerts) by structured filters, all ' +
        'optional but at least one required: the people involved (wrote, reviewed, own or took part in it), a day range, ' +
        'document types, words in the title, or words in the text. Day numbers are the company timeline (Day 1, Day 2, ...). ' +
        'Returns each document with id, type, title, day and the people involved with their role; documents involving more ' +
        "of the given people come first. Use it to locate a specific event: 'the incident on Day 8 involving Jax and " +
        "Kaitlyn' is people [Jax, Kaitlyn], fromDay 8, toDay 8. People outside the company (customers, vendors) are not " +
        `people here: find them with textContains plus a day range (at most ${TEXT_SCAN_MAX_DAYS} days). Use get_artifact to ` +
        'open one, and what_followed to see what happened after it.',
      inputSchema: {
        people: z.array(z.string().trim().min(1).max(100)).max(6).optional().describe('Names of people involved (any of them).'),
        fromDay: z.number().int().min(0).max(1000).optional().describe('First day number (inclusive).'),
        toDay: z.number().int().min(0).max(1000).optional().describe('Last day number (inclusive).'),
        types: z.array(z.enum(ARTIFACT_TYPES)).max(ARTIFACT_TYPES.length).optional()
          .describe('Document types: jira (tickets), confluence (pages), slack, pr, email, zoom_transcript (meetings), datadog_alert, zd_ticket (support tickets), sf_opp (sales deals), invoice, nps_survey.'),
        titleContains: z.string().trim().min(2).max(200).optional().describe('Words that appear in the title (case-insensitive).'),
        textContains: z.string().trim().min(2).max(200).optional().describe('Words that appear in the title or text (needs people or a day range).'),
        limit: z.number().int().min(1).max(FIND_MAX_LIMIT).optional().describe('How many to return (default 20).'),
      },
    },
    run(async (filter) => {
      const result = await artifacts.find(filter, graph);
      return { data: result, evidence: unique(result.artifacts.map((a) => a.id)) };
    }),
  );

  server.registerTool(
    'get_artifact',
    {
      title: 'Open one document',
      description:
        'One document by id: its type, title and day; everyone involved and how (authored, reviewed, assigned, participated) ' +
        'with the first day of their involvement; the documents it links to or that link to it (references and fixes); and the ' +
        "start of its text. Use it to check who was part of something ('could X have known about Y?': was X involved in Y or " +
        'in a document linked to it, and on which day?) and to follow a chain from one document to the next.',
      inputSchema: {
        id: z.string().trim().min(1).max(300).describe('The artifact id, e.g. "ENG-123".'),
      },
    },
    run(async ({ id }) => {
      const result = await artifacts.context(id, graph);
      return { data: result, evidence: unique([result.id, ...result.links.map((l) => l.id)]) };
    }),
  );

  server.registerTool(
    'what_followed',
    {
      title: 'What happened after a document',
      description:
        'What followed one document: documents from its day to `days` later (default 10) that are linked to it, or involve ' +
        "someone who was involved in it, optionally only some types. Use it for 'was anything done in response to X?', 'was a " +
        "ticket, postmortem or page created after X?', and to check whether an event led to another. An empty list means " +
        'nothing in the records followed it in that window: say so, and cite the starting document as what you checked.',
      inputSchema: {
        id: z.string().trim().min(1).max(300).describe('The id of the starting document (find it with find_artifacts).'),
        days: z.number().int().min(0).max(FOLLOW_MAX_DAYS).optional().describe('How many days after it to look (default 10).'),
        types: z.array(z.enum(ARTIFACT_TYPES)).max(ARTIFACT_TYPES.length).optional().describe('Only these document types.'),
      },
    },
    run(async ({ id, days, types }) => {
      const result = await artifacts.whatFollowed(id, { days, types }, graph);
      // The starting document is evidence too: it is what an "it did not happen" answer cites.
      return { data: result, evidence: unique([result.source.id, ...result.followed.map((f) => f.id)]) };
    }),
  );

  server.registerTool(
    'find_event',
    {
      title: 'Find the documents of an event',
      description:
        'Finds the documents of one event from how a question describes it: the day, the people in it and a few words about ' +
        `it. Looks at every document within ${EVENT_MAX_TOLERANCE} days at most (default 2 either side, because messages can be ` +
        'dated a day or two late) and ranks them: people involved count most, then description words in the title, then in ' +
        "the text, minus one per day away. Use it first for questions about a specific event ('the incident on Day 8 involving " +
        "Jax and Kaitlyn': day 8, people [Jax, Kaitlyn], description 'incident'). Customers and vendors are not people here: " +
        'put their names in the description. Then use check_follow_up, check_involvement or check_causal_link on the best ids.',
      inputSchema: {
        day: z.number().int().min(0).max(1000).describe('The day number of the event.'),
        people: z.array(z.string().trim().min(1).max(100)).max(6).optional().describe('Employees named in the question.'),
        description: z.string().trim().max(300).optional().describe('A few words about the event, e.g. "incident postmortem" or "Metro United FC email".'),
        types: z.array(z.enum(ARTIFACT_TYPES)).max(ARTIFACT_TYPES.length).optional().describe('Only these document types.'),
        tolerance: z.number().int().min(0).max(EVENT_MAX_TOLERANCE).optional().describe('Days either side to look (default 2).'),
      },
    },
    run(async (input) => {
      const result = await artifacts.findEvent(input, graph);
      return { data: result, evidence: unique(result.candidates.map((c) => c.id)) };
    }),
  );

  server.registerTool(
    'check_follow_up',
    {
      title: 'Did a response follow?',
      description:
        "Answers 'was a <kind> created after / in response to this document?' from the graph: documents linked to it " +
        `(references or fixes, up to two links away), dated from its day to \`days\` later (default ${FOLLOW_UP_DEFAULT_DAYS}), of ` +
        'that kind. Kinds: postmortem, ticket (Jira), support_ticket (Zendesk), page (Confluence), email, thread (Slack), meeting, ' +
        'pull_request, alert, deal (Salesforce), any. Returns followed (true or false) and the responses. followed: false means the ' +
        'records hold no such linked response in that window: answer No and cite the starting document as what you checked.',
      inputSchema: {
        id: z.string().trim().min(1).max(300).describe('The triggering document (find it with find_event).'),
        kind: z
          .enum(FOLLOW_UP_KIND_NAMES)
          .describe(
            'The kind of response asked about. Match the words in the question, not the general idea of "a ticket": ' +
              '"Zendesk ticket/escalation/support case" is support_ticket; "Jira ticket/engineering ticket/bug" is ticket; ' +
              'when the question just says "a ticket" with no system named, prefer support_ticket only if Zendesk, a customer, ' +
              'or a support case was mentioned earlier in the question, otherwise ticket.',
          ),
        days: z.number().int().min(0).max(FOLLOW_MAX_DAYS).optional().describe(`How many days after it to look (default ${FOLLOW_UP_DEFAULT_DAYS}).`),
      },
    },
    run(async ({ id, kind, days }) => {
      const result = await artifacts.checkFollowUp(id, kind, days, graph);
      return { data: result, evidence: unique([result.source.id, ...result.responses.map((r) => r.id)]) };
    }),
  );

  server.registerTool(
    'check_involvement',
    {
      title: 'Was this person involved?',
      description:
        "Answers 'could this person have known about / seen this?' from the graph: for each document, the person's direct " +
        'involvement by asOfDay (authored, reviewed, assigned, participated, received it, or listed on it) and any linked ' +
        'document they were directly involved in. involved: true means a direct part in at least one of them. involved: false ' +
        'means the records show no involvement by that day, so they could not have known through it: answer accordingly and ' +
        'cite the documents you checked. onlyViaLinked: true means they only touched a linked document, a weaker sign.',
      inputSchema: {
        person: z.string().trim().min(1).max(100).describe('The employee.'),
        ids: z.array(z.string().trim().min(1).max(300)).min(1).max(10).describe('The event documents (find them with find_event).'),
        asOfDay: z.number().int().min(0).max(1000).optional().describe('Only involvement on or before this day.'),
      },
    },
    run(async ({ person, ids, asOfDay }) => {
      const result = await artifacts.checkInvolvement(person, ids, asOfDay ?? null, graph);
      return { data: result, evidence: unique(result.artifacts.flatMap((a) => [a.id, ...a.viaLinked])) };
    }),
  );

  server.registerTool(
    'check_visibility',
    {
      title: 'Could this person have known?',
      description:
        "Answers 'could / would <person> have known about, seen or learned of <event> by Day N?' in one call: it finds the " +
        'event from the day and a description WITHOUT using the person (they may not be part of it), decides on the best ' +
        "matching document, and checks the person's involvement in it by that day. verdict: 'could_have_known' either because " +
        'they wrote, reviewed, owned, took part in, received or were listed on it (roles non-empty, or viaLinked non-empty), ' +
        'or because broadcast is true: the event is an incident, outage, postmortem or detected knowledge gap, which goes out ' +
        "company-wide rather than only to the people on the one matched document, so say it reached them through normal channels, " +
        "not that they were personally listed on it. 'no_record_of_involvement' means a private document (a single PR review, a " +
        "1:1 email, one page) with no direct or linked record and no broadcast signal, so they could not have known through it. " +
        "'event_not_found' means nothing matched. Pass a quoted title as title, and other people the question names as part of " +
        'the event as eventPeople. If event is clearly not the one asked about, call again with better words.',
      inputSchema: {
        person: z.string().trim().min(1).max(100).describe('The person whose knowledge is asked about.'),
        day: z.number().int().min(0).max(1000).describe('The day asked about ("by Day N").'),
        description: z.string().trim().min(1).max(300).describe('A few words about the event, e.g. "incident resolved" or "vendor email routed".'),
        title: z.string().trim().min(2).max(200).optional().describe('The document title if the question quotes one.'),
        eventPeople: z.array(z.string().trim().min(1).max(100)).max(6).optional().describe('Other people named as part of the event.'),
        types: z.array(z.enum(ARTIFACT_TYPES)).max(ARTIFACT_TYPES.length).optional().describe('Only these document types.'),
      },
    },
    run(async (input) => {
      const result = await artifacts.checkVisibility(input, graph);
      return { data: result, evidence: unique([...(result.event ? [result.event.id] : []), ...result.viaLinked, ...result.runnersUp.map((r) => r.id)]) };
    }),
  );

  server.registerTool(
    'check_causal_link',
    {
      title: 'Did one event lead to another?',
      description:
        "For 'had X not happened, would Y still have happened?': did the later event follow from the earlier one? verdict: " +
        "'linked' (a chain of references or fixes, up to three links, ties Y's document to X's), 'likely' (no link, but Y came " +
        `within ${CAUSAL_PROXIMITY_DAYS} days after X among the same people) or 'no_evidence'. linked or likely: Y followed from X, so ` +
        'without X it would not have happened as it did. no_evidence: nothing recorded ties them. Find both events with find_event first.',
      inputSchema: {
        causes: z.array(z.string().trim().min(1).max(300)).min(1).max(10).describe('Documents of the earlier event.'),
        effects: z.array(z.string().trim().min(1).max(300)).min(1).max(10).describe('Documents of the later outcome.'),
      },
    },
    run(async ({ causes, effects }) => {
      const result = await artifacts.checkCausalLink(causes, effects, graph);
      // Only ids that exist: the citation guardrail trusts evidence, so a made-up id must never get in.
      return { data: result, evidence: unique([...result.checked, ...result.links.flatMap((l) => l.via)]) };
    }),
  );

  server.registerTool(
    'who_knows',
    {
      title: 'Experts on a system',
      description:
        'Who knows one system best: the five strongest active experts, each with relativeScore, lastActive (the day number of ' +
        "their latest work on it in the company's timeline, where a higher number is more recent; not a number of days ago), the " +
        'artifact ids most about the system that show it and, as sources, each of them with its title and how the person worked on ' +
        'it, plus an evidence graph for the top expert. relativeScore is expertise as a share of the top expert (1 = the strongest, ' +
        '0.5 = half as much), from recency-weighted work (writing a document about the ' +
        'system counts 3, reviewing 2, owning a ticket 1, taking part in a conversation up to 0.5; older work counts less, halving ' +
        "about every three weeks). Describe experts in words ('top expert', 'a strong backup at about half'), not as numbers or " +
        "percentages of anything else. Use it for 'who knows X', 'who is the expert on X', 'who should I ask about " +
        "X'. If the name is not a known system, the result has found: false and up to five similar system names: call it again with " +
        "one of them. Not for what happens if someone leaves (use simulate_departure).",
      inputSchema: {
        system: z.string().trim().min(1).max(200).describe('The system name, e.g. "TitanDB" (see list_systems).'),
      },
    },
    run(async ({ system }) => {
      try {
        const result = await analytics.experts(system, graph);
        // The raw score is left out: it is an unbounded sum that models quote as if it meant something on its own.
        // Sources carry titles and roles, so the answer can say what each person did, not only cite ids.
        const sources = await analytics.expertSources(result.experts, graph);
        const experts = result.experts.map((e) => ({
          person: e.person,
          relativeScore: e.relativeScore,
          lastActive: e.lastActive,
          evidence: e.evidence,
          sources: sources.get(e.person) ?? [],
        }));
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
    'central_people',
    {
      title: 'People at the centre of the network',
      description:
        'The ten people at the centre of the collaboration network: PageRank on who works with whom (working with well-connected ' +
        'colleagues counts more), each with their department and artifacts shared with other departments as evidence. Use it for ' +
        "'who are the most influential people', 'who is central to how work gets done'. For who connects separate teams use " +
        'bridge_people; for expertise in a system use who_knows. relativeScore: 1 = the most central person.',
      inputSchema: {},
    },
    run(async () => {
      const rows = await analytics.centralPeople(projection, graph);
      const top = rows[0]?.score || 1;
      const people = rows.map((p) => ({ person: p.person, dept: p.dept, relativeScore: round(p.score / top, 2), evidence: p.evidence }));
      return { data: { people }, evidence: unique(people.flatMap((p) => p.evidence)) };
    }),
  );

  server.registerTool(
    'how_connected',
    {
      title: 'How two things are connected',
      description:
        'The shortest chain in the graph between two people or systems (FalkorDB shortest path): what a person worked on that ' +
        'mentions a system, which colleagues link two people (with the documents each pair worked on together), or which ' +
        "documents and people link two systems. Use it for 'how is X connected to Y', 'who could introduce me to the X owner', " +
        "'why would X know about Y'. Exact names: list_people, list_systems. connected: false means no chain of at most 5 steps.",
      inputSchema: {
        from: z.string().trim().min(1).max(200).describe('A person or a system, e.g. "Nadia".'),
        to: z.string().trim().min(1).max(200).describe('A system or another person, e.g. "Kafka".'),
      },
    },
    run(async ({ from, to }) => {
      const result = await analytics.howConnected(from, to, graph);
      return {
        data: { from: result.from, to: result.to, connected: result.connected, hops: result.hops, steps: result.steps },
        evidence: result.evidence,
        ...(result.connected ? { graphPath: { nodes: result.view.nodes, edges: result.view.edges } } : {}),
      };
    }),
  );

  server.registerTool(
    'triage_incident',
    {
      title: 'Triage an incident',
      description:
        'Triage an incident, alert or incident thread by its artifact id, from the graph: the systems it is about (also through ' +
        'what it references, so a Datadog alert reaches its incident ticket), who can respond now (active people ranked by ' +
        'expertise on those systems, relativeScore 1 = the best), and earlier incidents on the same systems with the PRs that ' +
        "fixed them and who wrote those. Use it for 'who should handle this incident/alert', 'has this happened before', " +
        "'what fixed it last time'. Find the id first with find_artifacts or search_knowledge if you only have a description. " +
        'To act on it, propose_reassignment moves a ticket to the best responder.',
      inputSchema: {
        incident: z.string().trim().min(1).max(200).describe('Artifact id of the incident, alert or thread, e.g. "DD-ENG-230" or "ENG-230".'),
      },
    },
    run(async ({ incident }) => {
      const triage = await analytics.triageIncident(incident, graph);
      const top = triage.responders[0]?.score || 1;
      const responders = triage.responders.map((r) => ({ person: r.person, dept: r.dept, relativeScore: round(r.score / top, 2), knows: r.knows, evidence: r.evidence }));
      return {
        data: { incident: triage.incident, systems: triage.systems, responders, pastIncidents: triage.pastIncidents },
        evidence: unique([
          triage.incident.id,
          ...triage.incident.linked,
          ...triage.pastIncidents.flatMap((p) => [p.id, ...p.fixes.map((f) => f.id)]),
          ...responders.flatMap((r) => r.evidence),
        ]),
      };
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
        'owners, and pages only they wrote, each with artifact ids, plus a graph around the person. These cover every system the ' +
        'person knows, not only one a question started from. Use it for "what if X leaves", ' +
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
        // Raw betweenness means nothing to a reader: say how much more or less each person connects teams.
        bridgeShift: r.bridgeShift.slice(0, 5).map((b) => ({ person: b.person, change: connectorChange(b.before, b.after), evidence: b.evidence })),
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
        "'which docs are out of date', 'stale documentation', 'which pages need updating', 'is page X still accurate'. An empty " +
        'list means no page is known to contradict a newer decision. Cite the page id and the decidedIn id (both artifacts).',
      inputSchema: {},
    },
    run(async () => {
      // Decision ids (D:...) are left out: they are not artifacts, so a model citing them would lose every citation.
      const pages = (await analytics.staleDocs(graph)).map((p) => ({
        page: p.stalePage,
        pageTitle: p.pageTitle,
        stillStates: p.outdatedClaim,
        replacedBy: p.currentDecision,
        decidedOnDay: p.decidedOn,
        decidedIn: p.decidedIn,
      }));
      return {
        data: { pages },
        evidence: unique(pages.flatMap((p) => [p.page, ...(p.decidedIn ? [p.decidedIn] : [])])),
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

  // Actions: these tools only PROPOSE. Approving and rejecting happen in Keystone, by a person
  // (POST /actions/:id/approve), and are not available as tools.
  const proposalNote =
    "It only creates a proposal with status 'proposed': nothing changes until a person approves it in Keystone. " +
    'Approving or rejecting is not available as a tool, so you cannot approve your own proposals.';

  server.registerTool(
    'draft_handover',
    {
      title: 'Draft a handover plan',
      description:
        'Drafts a handover plan for a person who is leaving: one reassignment per open ticket they own (to the best-suited ' +
        'colleague), one review task per page only they wrote (for the strongest other expert on its main system) and one runbook ' +
        'task per system only they know (for them, before they go), with a short summary and the evidence for each item. ' +
        `${proposalNote} If an open plan for the person already exists, that plan is returned instead. Use it when the user asks ` +
        'for a handover or a plan for someone leaving, typically after simulate_departure; the person must be an active employee.',
      inputSchema: { person: z.string().trim().min(1).max(200).describe('Exact name of the person leaving (see list_people).') },
    },
    run(async ({ person }) => {
      const result = await actions.draftHandover(person);
      const byKind: Record<string, number> = {};
      for (const child of result.children) byKind[child.kind] = (byKind[child.kind] ?? 0) + 1;
      return {
        data: {
          created: result.created,
          plan: compactAction(result.plan),
          actionsByKind: byKind,
          actions: result.children.slice(0, MAX_LIST_ITEMS).map(compactAction),
          totalActions: result.children.length,
          skipped: result.skipped.slice(0, MAX_LIST_ITEMS),
        },
        evidence: unique([result.plan, ...result.children].flatMap((a) => a.evidence.map((e) => e.id))).slice(0, 60),
      };
    }),
  );
  server.registerTool(
    'propose_reassignment',
    {
      title: 'Propose a ticket reassignment',
      description:
        "Proposes moving one ticket to a person, with your reason; the person's evidence on the systems the ticket names is " +
        `attached. ${proposalNote} The ticket stays with its current owner until then. If an open proposal already targets the ` +
        "ticket, that proposal is returned instead. Use it when the user asks to reassign a ticket; simulate_departure suggests " +
        "owners for a leaver's tickets.",
      inputSchema: {
        ticketId: z.string().trim().min(1).max(100).describe('The ticket id, e.g. "ENG-100".'),
        person: z.string().trim().min(1).max(200).describe('Exact name of the active employee who should take it.'),
        reason: z.string().trim().min(1).max(1000).describe('Why this person, in one or two sentences.'),
      },
    },
    run(async ({ ticketId, person, reason }) => {
      const { action, created } = await actions.proposeReassignment(ticketId, person, reason);
      return { data: { created, action: compactAction(action) }, evidence: action.evidence.map((e) => e.id) };
    }),
  );
  server.registerTool(
    'create_runbook_task',
    {
      title: 'Propose a runbook task',
      description:
        'Proposes a task to write or update the runbook of one system, assigned to its single expert (or its strongest expert), ' +
        `with the bus-factor evidence attached. ${proposalNote} If an open runbook task already exists for the system, that task ` +
        'is returned instead. Use it for systems that depend on one person (see bus_factor).',
      inputSchema: { system: z.string().trim().min(1).max(200).describe('The system name (see list_systems).') },
    },
    run(async ({ system }) => {
      const { action, created } = await actions.createRunbookTask(system);
      return { data: { created, action: compactAction(action) }, evidence: action.evidence.map((e) => e.id) };
    }),
  );

  // Memory is optional: the benchmark builds its server without it, so its runs never see each other.
  if (services.memory) {
    const memory = services.memory;
    server.registerTool(
      'recall_memory',
      {
        title: 'What Keystone remembers',
        description:
          'What Keystone remembers about some systems or people: approved notes from colleagues (corrections and facts the ' +
          'documents do not have yet, e.g. a change of owner), how often each was asked about, and the latest questions with the ' +
          'start of their answers. Use it when a question is about ownership, expertise or a decision that may have changed ' +
          'recently, or asks what was asked before. An approved note outranks older documents but does not erase them: give ' +
          'both. Cite notes by their NOTE- id. Notes not yet approved are never returned.',
        inputSchema: {
          subjects: z.array(z.string().trim().min(1).max(200)).min(1).max(5).describe('Exact system or person names, e.g. ["TitanDB", "Priya"].'),
        },
      },
      run(async ({ subjects }) => {
        const rows = await memory.recall(subjects);
        return { data: { subjects, found: rows }, evidence: unique(rows.flatMap((r) => r.notes.map((n) => n.id))) };
      }),
    );
  }

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

/** The parts of an action a model needs (the evidence ids go in the envelope's evidence). */
function compactAction(a: ActionRow) {
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    target: a.target,
    targetTitle: a.targetTitle,
    assignee: a.assignee,
    reason: a.reason,
    ...(a.summary ? { summary: a.summary } : {}),
    ...(a.planId ? { planId: a.planId } : {}),
  };
}

/** A connector's change after a departure, in words: "+12%", "-6%", "joins the top connectors", "leaves the top connectors". */
export function connectorChange(before: number | null, after: number | null): string {
  if (before === null && after !== null) return 'joins the top connectors';
  if (before !== null && after === null) return 'leaves the top connectors';
  if (!before || after === null) return 'no change';
  const percent = Math.round(((after - before) / before) * 100);
  return percent === 0 ? 'no change' : `${percent > 0 ? '+' : ''}${percent}% as a connector between teams`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
