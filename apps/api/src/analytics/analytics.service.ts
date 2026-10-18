import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AnalyticsSummary, Bridge, BusFactorRow, DecisionTraceRow, Expert, ExpertsResponse, GraphView, PersonListItem, StaleDoc, SystemWithDecisions } from '@keystone/shared';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import type { GraphPath } from '../graph/result-mapper';
import { DONE_STATUSES, EXPERT_SHARE_OF_TOP, MIN_EXPERT_SCORE, PROJECTION_GRAPH, type RiskLevel, riskLevel } from './analytics.constants';
import { closestNames } from './closest-names';
import { pathsToGraphView } from './graph-view';
import * as Q from './queries/analytics.queries';

// Response shapes. Every fact carries the artifact ids it came from (`evidence`, `source`, ids).
// The ones the web app reads are Zod schemas in @keystone/shared (one definition for both sides).
export type { AnalyticsSummary, Bridge, BusFactorRow, DecisionTraceRow, Expert, ExpertsResponse, StaleDoc };

export interface DepartureImpact {
  person: string;
  dept: string | null;
  minScore: number;
  systems: { system: string; leaverScore: number; backups: number; backupNames: string[]; evidence: string[] }[];
  /** Systems where the leaver is the only expert. */
  orphanedSystems: string[];
  /** ownerEvidence[i] = artifact ids showing why suggestedOwners[i] fits. */
  openTickets: { ticket: string; title: string; suggestedOwners: string[]; ownerEvidence: string[][] }[];
  /** Pages only this person has written or reviewed. */
  unsharedPages: { page: string; title: string }[];
}

/** Edges a chain between two people may use: collaboration only, so each step is two colleagues. */
const PEOPLE_PATH_RELS = ['COLLAB'];
/** Edges a chain to or between systems may use: work on artifacts, what they mention, collaboration. */
const WORK_PATH_RELS = ['AUTHORED', 'REVIEWED', 'ASSIGNED', 'PARTICIPATED', 'MENTIONS', 'COLLAB'];

/** How two things are connected (howConnected): the steps of the shortest chain and the artifacts on it. */
export interface Connection {
  from: string;
  to: string;
  connected: boolean;
  hops: number;
  /** "Nadia -PARTICIPATED-> zoom_2026-02-03 -MENTIONS-> Kafka"; a COLLAB step carries the documents both worked on. */
  steps: { from: string; type: string; to: string; shared?: string[] }[];
  view: GraphView;
  evidence: string[];
}

/**
 * Read-only analytics (roQuery only). Queries that need tickets, pages and
 * decisions run on apex; bus factor and betweenness run on the small projection.
 * Graph names are parameters so What-if can run the same methods on a copy.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly graph: GraphService) {}

  /** K3a + K3b: the top experts on a system and the evidence graph of the strongest one. */
  async experts(system: string, graphName = APEX_GRAPH): Promise<ExpertsResponse> {
    await this.requireSystem(system, graphName);
    const experts = await this.graph.roQuery<Expert>(graphName, Q.K3A_SYSTEM_EXPERTS, { system });
    const top = experts[0];
    if (!top) return { system, experts, evidencePath: null };

    const paths = await this.graph.roQuery<{ path: GraphPath }>(graphName, Q.K3B_EVIDENCE_PATH, { person: top.person, system });
    const view = pathsToGraphView(paths.map((row) => row.path));
    const evidence = view.nodes.flatMap((node) => (node.artifactId ? [node.artifactId] : []));
    return { system, experts, evidencePath: { person: top.person, ...view, evidence } };
  }

  /** K4: experts per system with a risk level (0 orphaned, 1 critical, 2 watch, 3+ ok). */
  async busFactor(minScore = MIN_EXPERT_SCORE, graphName = PROJECTION_GRAPH, topShare = EXPERT_SHARE_OF_TOP): Promise<BusFactorRow[]> {
    await this.requireGraph(graphName);
    const rows = await this.graph.roQuery<Omit<BusFactorRow, 'riskLevel'>>(graphName, Q.K4_BUS_FACTOR, { minScore, topShare });
    return rows.map((row) => ({ ...row, riskLevel: riskLevel(row.experts) }));
  }

  /** K8b on the projection, plus each person's cross-department evidence from apex. */
  async bridges(graphName = PROJECTION_GRAPH, evidenceGraph = APEX_GRAPH): Promise<Bridge[]> {
    await this.requireGraph(graphName);
    return this.withEvidence(await this.graph.roQuery<{ person: string; score: number }>(graphName, Q.K8B_BRIDGES), evidenceGraph);
  }

  /** K8c (PageRank on the projection): the centre of the collaboration network, with the same evidence as bridges. */
  async centralPeople(graphName = PROJECTION_GRAPH, evidenceGraph = APEX_GRAPH): Promise<Bridge[]> {
    await this.requireGraph(graphName);
    return this.withEvidence(await this.graph.roQuery<{ person: string; score: number }>(graphName, Q.K8C_CENTRAL_PEOPLE), evidenceGraph);
  }

  /** Each person's department and up to 5 artifacts shared with other departments (BRIDGE_EVIDENCE). */
  private async withEvidence(rows: { person: string; score: number }[], evidenceGraph: string): Promise<Bridge[]> {
    return Promise.all(
      rows.map(async (row) => {
        const [found] = await this.graph.roQuery<{ dept: string | null; evidence: string[] }>(evidenceGraph, Q.BRIDGE_EVIDENCE, {
          person: row.person,
        });
        return { person: row.person, score: row.score, dept: found?.dept ?? null, evidence: found?.evidence ?? [] };
      }),
    );
  }

  /** K5 + K6 + K7: what is lost if this person leaves. */
  async departureImpact(
    person: string,
    minScore = MIN_EXPERT_SCORE,
    graphName = APEX_GRAPH,
    topShare = EXPERT_SHARE_OF_TOP,
  ): Promise<DepartureImpact> {
    const [who] = await this.graph.roQuery<{ name: string; dept: string | null }>(graphName, Q.PERSON_EXISTS, { person });
    if (!who) throw new NotFoundException(`No person named "${person}"`);

    const [systems, openTickets, unsharedPages] = await Promise.all([
      this.graph.roQuery<DepartureImpact['systems'][number]>(graphName, Q.K5_DEPARTURE_SYSTEMS, { person, minScore, topShare }),
      this.graph.roQuery<DepartureImpact['openTickets'][number]>(graphName, Q.K6_DEPARTURE_TICKETS, {
        person,
        doneStatuses: DONE_STATUSES,
      }),
      this.graph.roQuery<DepartureImpact['unsharedPages'][number]>(graphName, Q.K7_DEPARTURE_PAGES, { person }),
    ]);
    return {
      person,
      dept: who.dept,
      minScore,
      systems,
      orphanedSystems: systems.filter((s) => s.backups === 0).map((s) => s.system),
      openTickets,
      unsharedPages,
    };
  }

  /** K10a: decisions about a system, newest first, with the artifact each was made in. */
  async decisions(system: string, graphName = APEX_GRAPH): Promise<DecisionTraceRow[]> {
    await this.requireSystem(system, graphName);
    return this.graph.roQuery<DecisionTraceRow>(graphName, Q.K10A_DECISION_TRACE, { system });
  }

  /** K10b: pages that still assert a superseded decision. */
  async staleDocs(graphName = APEX_GRAPH): Promise<StaleDoc[]> {
    return this.graph.roQuery<StaleDoc>(graphName, Q.K10B_STALE_DOCS);
  }

  /** Dashboard counts: people, systems by risk level, stale docs, open tickets, memory. */
  async summary(
    minScore = MIN_EXPERT_SCORE,
    graphName = APEX_GRAPH,
    projectionGraph = PROJECTION_GRAPH,
    topShare = EXPERT_SHARE_OF_TOP,
  ): Promise<AnalyticsSummary> {
    await this.requireGraph(projectionGraph);
    const [[people], [risk], [stale], [open], memory] = await Promise.all([
      this.graph.roQuery<{ active: number; inactive: number }>(graphName, Q.PEOPLE_COUNTS),
      this.graph.roQuery<Record<RiskLevel, number>>(projectionGraph, Q.RISK_LEVEL_COUNTS, { minScore, topShare }),
      this.graph.roQuery<{ stale: number }>(graphName, Q.STALE_DOCS_COUNT),
      this.graph.roQuery<{ open: number }>(graphName, Q.OPEN_TICKETS_COUNT, { doneStatuses: DONE_STATUSES }),
      this.graph.memoryReport(),
    ]);
    const [day] = await this.graph.roQuery<{ day: number | null }>(graphName, Q.LAST_ARTIFACT_DAY);
    return {
      graph: graphName,
      day: day?.day ?? null,
      people: people ?? { active: 0, inactive: 0 },
      systems: risk ?? { orphaned: 0, critical: 0, watch: 0, ok: 0 },
      minScore,
      staleDocs: stale?.stale ?? 0,
      openTickets: open?.open ?? 0,
      memory,
    };
  }

  /** Core systems, most mentioned first: the names worth asking about. */
  async listCoreSystems(graphName = APEX_GRAPH): Promise<{ name: string; mentionCount: number; authorCount: number }[]> {
    return this.graph.roQuery(graphName, Q.LIST_CORE_SYSTEMS);
  }

  /** Systems with decisions for the Decisions screen: core ones and any with a replaced decision. */
  async systemsWithDecisions(graphName = APEX_GRAPH): Promise<SystemWithDecisions[]> {
    return this.graph.roQuery(graphName, Q.SYSTEMS_WITH_DECISIONS);
  }

  /** People with department and activity; `activeOnly` drops people who have left. */
  async listPeople(
    activeOnly = false,
    graphName = APEX_GRAPH,
  ): Promise<PersonListItem[]> {
    return this.graph.roQuery(graphName, Q.LIST_PEOPLE, { activeOnly });
  }

  /**
   * How a person is connected to a system or to another person: the shortest chain
   * in the graph, its steps in words, and the artifacts along it (for a chain of
   * colleagues, the documents each pair worked on together), between any two people
   * or systems.
   */
  async howConnected(from: string, to: string, graphName = APEX_GRAPH): Promise<Connection> {
    const kindOf = async (name: string): Promise<'person' | 'system' | null> => {
      if ((await this.graph.roQuery(graphName, Q.PERSON_EXISTS, { person: name })).length > 0) return 'person';
      if ((await this.graph.roQuery(graphName, Q.SYSTEM_EXISTS, { system: name })).length > 0) return 'system';
      return null;
    };
    const [fromKind, toKind] = await Promise.all([kindOf(from), kindOf(to)]);
    if (!fromKind) throw new NotFoundException(`No person or system named "${from}"`);
    if (!toKind) throw new NotFoundException(`No person or system named "${to}"`);
    // People first, so "TitanDB -> Eve" reads as Eve's chain to TitanDB.
    const swap = fromKind === 'system' && toKind === 'person';
    const [a, b] = swap ? [to, from] : [from, to];
    const pair = swap ? 'person-system' : `${fromKind}-${toKind}`;
    const query =
      pair === 'person-person' ? Q.SHORTEST_PERSON_TO_PERSON : pair === 'person-system' ? Q.SHORTEST_PERSON_TO_SYSTEM : Q.SHORTEST_SYSTEM_TO_SYSTEM;
    const relTypes = pair === 'person-person' ? PEOPLE_PATH_RELS : WORK_PATH_RELS;
    const [row] = await this.graph.roQuery<{ path: GraphPath }>(graphName, query, { from: a, to: b, relTypes });
    if (!row) return { from, to, connected: false, hops: 0, steps: [], view: { nodes: [], edges: [] }, evidence: [] };

    const view = pathsToGraphView([row.path]);
    // Steps in walking order (the path's node order); an edge may be stored the other way round.
    const names = row.path.nodes.map((node) => view.nodes.find((n) => n.id === node.id)?.name ?? '?');
    const steps: Connection['steps'] = row.path.edges.map((edge, i) => ({ from: names[i], type: edge.type, to: names[i + 1] }));
    const evidence = view.nodes.flatMap((n) => (n.artifactId ? [n.artifactId] : []));
    // COLLAB is stored once per pair, so a step may point either way: look the pair up in both orders.
    const pairs = steps.filter((s) => s.type === 'COLLAB').flatMap((s) => [[s.from, s.to], [s.to, s.from]]);
    if (pairs.length > 0) {
      const shared = await this.graph.roQuery<{ a: string; b: string; shared: string[] }>(graphName, Q.SHARED_ARTIFACTS, { pairs });
      for (const step of steps) {
        const found = shared.find((r) => (r.a === step.from && r.b === step.to) || (r.a === step.to && r.b === step.from));
        if (found) step.shared = found.shared;
        evidence.push(...(found?.shared ?? []));
      }
    }
    return { from, to, connected: true, hops: steps.length, steps, view, evidence: [...new Set(evidence)] };
  }

  /** "Did you mean": the system names closest to one that was not found (aliases count). */
  async similarSystems(name: string, graphName = APEX_GRAPH, limit = 5): Promise<string[]> {
    const systems = await this.graph.roQuery<{ name: string; aliases: string[] }>(graphName, Q.SYSTEM_NAMES);
    return closestNames(name, systems, limit);
  }

  private async requireSystem(system: string, graphName: string): Promise<void> {
    const rows = await this.graph.roQuery(graphName, Q.SYSTEM_EXISTS, { system });
    if (rows.length === 0) throw new NotFoundException(`No system named "${system}"`);
  }

  /** The projection is built by the refresh-expertise job; say so instead of failing obscurely. */
  private async requireGraph(graphName: string): Promise<void> {
    if (!(await this.graph.listGraphs()).includes(graphName)) {
      throw new ServiceUnavailableException(`Graph "${graphName}" does not exist yet; run POST /analytics/refresh-expertise`);
    }
  }
}
