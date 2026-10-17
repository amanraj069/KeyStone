import type { BridgeShift, Island, SimulationEdge, SimulationGraph, SimulationNode, SystemChange } from '@keystone/shared';
import type { Bridge, BusFactorRow, DepartureImpact } from '../analytics/analytics.service';

/** Shapes of the simulation result: Zod schemas in @keystone/shared (the web app parses them). */
export type { BridgeShift, Island, SimulationEdge, SimulationGraph, SimulationNode, SystemChange };

// Comparing the before/after results that FalkorDB computed (set differences
// and look-ups only; every count, score and algorithm ran in Cypher).

const MAX_EVIDENCE = 5;

/** Systems that lose their last expert, and systems that drop from 2+ experts to exactly 1. */
export function diffBusFactor(
  before: readonly BusFactorRow[],
  after: readonly BusFactorRow[],
  leaver: string,
): { newlyOrphaned: SystemChange[]; newlyCritical: SystemChange[] } {
  const afterBySystem = new Map(after.map((row) => [row.system, row]));
  const newlyOrphaned: SystemChange[] = [];
  const newlyCritical: SystemChange[] = [];
  for (const row of before) {
    const next = afterBySystem.get(row.system);
    if (!next) continue;
    const leaverEvidence = row.evidence[row.names.indexOf(leaver)] ?? [];
    const change = (remaining: string[]) => ({
      system: row.system,
      expertsBefore: row.names,
      expertsAfter: next.names,
      evidence: unique([...leaverEvidence, ...remaining]).slice(0, MAX_EVIDENCE),
    });
    if (row.experts > 0 && next.experts === 0) newlyOrphaned.push(change([]));
    else if (row.experts >= 2 && next.experts === 1) newlyCritical.push(change(next.evidence[0] ?? []));
  }
  return { newlyOrphaned, newlyCritical };
}

/** Islands after the departure that were not islands before. */
export function newIslands(before: readonly string[], after: readonly string[]): string[] {
  const existing = new Set(before);
  return after.filter((system) => !existing.has(system)).sort();
}

/** Everyone in either top 10, with both scores, biggest change first. */
export function bridgeShift(before: readonly Bridge[], after: readonly Bridge[]): BridgeShift[] {
  const people = unique([...before.map((b) => b.person), ...after.map((b) => b.person)]);
  const find = (list: readonly Bridge[], person: string) => list.find((b) => b.person === person);
  return people
    .map((person) => ({
      person,
      before: find(before, person)?.score ?? null,
      after: find(after, person)?.score ?? null,
      evidence: (find(after, person) ?? find(before, person))?.evidence ?? [],
    }))
    .sort((a, b) => Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)));
}

// ---------------------------------------------------------------- graph for the animation

/**
 * The before-subgraph around the leaver: the systems they are an expert on
 * (fewest backups first, plus every system that changes status), the other
 * experts on those systems, and their open tickets, with flags for what the
 * departure breaks.
 */
export function simulationGraph(input: {
  person: string;
  impact: DepartureImpact;
  busFactorBefore: readonly BusFactorRow[];
  newlyOrphaned: readonly SystemChange[];
  newlyCritical: readonly SystemChange[];
  islands: readonly Island[];
  leaverScores: ReadonlyMap<string, number>;
  maxSystems: number;
}): SimulationGraph {
  const orphaned = new Set(input.newlyOrphaned.map((c) => c.system));
  const critical = new Set(input.newlyCritical.map((c) => c.system));
  const island = new Set(input.islands.map((i) => i.system));
  const scoreOf = new Map(input.impact.systems.map((s) => [s.system, s.leaverScore]));
  for (const [system, score] of input.leaverScores) if (!scoreOf.has(system)) scoreOf.set(system, score);

  const changed = unique([...orphaned, ...critical, ...island]);
  const ranked = unique([...changed, ...input.impact.systems.map((s) => s.system)]);
  const systems = ranked.slice(0, Math.max(input.maxSystems, changed.length));
  const expertsBySystem = new Map(input.busFactorBefore.map((row) => [row.system, row.names]));

  const nodes = new Map<string, SimulationNode>();
  const edges: SimulationEdge[] = [];
  const node = (id: string, kind: SimulationNode['kind'], name: string, flags: Partial<SimulationNode> = {}) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind, name, artifactId: null, leaving: false, orphaned: false, critical: false, island: false, ...flags });
    }
    return id;
  };

  const leaver = node(`person:${input.person}`, 'person', input.person, { leaving: true });
  for (const system of systems) {
    const id = node(`system:${system}`, 'system', system, {
      orphaned: orphaned.has(system),
      critical: critical.has(system),
      island: island.has(system),
    });
    edges.push({ source: leaver, target: id, type: 'KNOWS', score: scoreOf.get(system) ?? null });
    for (const expert of expertsBySystem.get(system) ?? []) {
      if (expert === input.person) continue;
      edges.push({ source: node(`person:${expert}`, 'person', expert), target: id, type: 'KNOWS', score: null });
    }
  }
  for (const ticket of input.impact.openTickets) {
    const id = node(`ticket:${ticket.ticket}`, 'ticket', ticket.title, { artifactId: ticket.ticket, orphaned: true });
    edges.push({ source: leaver, target: id, type: 'ASSIGNED', score: null });
  }
  return { nodes: [...nodes.values()], edges, truncated: ranked.length > systems.length };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
