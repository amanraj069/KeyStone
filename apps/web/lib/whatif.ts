import type { DepartureSimulation, SimulationGraph } from "@keystone/shared";
import { artifactKey, type CanvasGraph, personKey, systemKey, toCanvasGraph } from "./graph";

/**
 * The departure graph for the canvas. The simulation graph has the leaver, their
 * systems, the other experts and the open tickets; this adds each orphaned ticket's
 * best suggested owner with a SUGGESTED edge, so beat 3 has someone to light up.
 */
export function departureCanvas(graph: SimulationGraph, simulation: DepartureSimulation | null): CanvasGraph {
  if (!simulation) return toCanvasGraph([graph]);
  const nodes: unknown[] = [...graph.nodes];
  const edges: unknown[] = [...graph.edges];
  const known = new Set(graph.nodes.map((n) => n.id));
  for (const ticket of simulation.orphanedTickets) {
    const owner = ticket.suggestedOwners[0];
    const ticketId = `ticket:${ticket.ticket}`;
    if (!owner || !known.has(ticketId)) continue;
    const ownerId = `person:${owner}`;
    if (!known.has(ownerId)) {
      nodes.push({ id: ownerId, kind: "person", name: owner, artifactId: null });
      known.add(ownerId);
    }
    edges.push({ source: ticketId, target: ownerId, type: "SUGGESTED" });
  }
  return toCanvasGraph([{ nodes, edges }]);
}

/** The canvas keys each beat of the departure animation acts on. */
export interface DepartureKeys {
  leaver: string;
  /** Newly orphaned and newly critical systems: they pulse red. */
  atRisk: string[];
  /** Tickets whose owner leaves: red, without the pulse. */
  orphanedTickets: string[];
  /** Best suggested owners of the orphaned tickets, and the last expert of each newly critical system. */
  newOwners: string[];
}

export function departureKeys(simulation: DepartureSimulation): DepartureKeys {
  const unique = (keys: string[]) => [...new Set(keys)];
  return {
    leaver: personKey(simulation.person),
    atRisk: unique([...simulation.systemsNewlyOrphaned, ...simulation.systemsNewlyCritical].map((c) => systemKey(c.system))),
    orphanedTickets: simulation.orphanedTickets.map((t) => artifactKey(t.ticket)),
    newOwners: unique([
      ...simulation.orphanedTickets.flatMap((t) => (t.suggestedOwners[0] ? [personKey(t.suggestedOwners[0])] : [])),
      ...simulation.systemsNewlyCritical.flatMap((c) => (c.expertsAfter[0] ? [personKey(c.expertsAfter[0])] : [])),
    ]),
  };
}

/** Step names of timingsMs, in the order they run, as people would say them. */
export const TIMING_LABELS: [string, string][] = [
  ["validate", "checked person"],
  ["ensureProjection", "projection fresh"],
  ["copy", "copied graph"],
  ["before", "measured before"],
  ["removePerson", "removed person"],
  ["after", "recomputed"],
  ["departureImpact", "impact"],
  ["cleanup", "deleted copy"],
];
