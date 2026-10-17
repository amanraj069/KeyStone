import type { GraphPath, GraphView } from "@keystone/shared";

/** A node as the canvas draws it. `key` is stable across tools (see canonicalKey). */
export interface CanvasNode {
  key: string;
  label: string;
  name: string;
  /** Set for artifacts, so a click can open it and a citation can find it. */
  artifactId: string | null;
}

export interface CanvasEdge {
  source: string;
  target: string;
  type: string;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const EMPTY_GRAPH: CanvasGraph = { nodes: [], edges: [] };

/** The canvas key of an artifact, for highlighting by artifact id (citations, evidence). */
export const artifactKey = (artifactId: string) => `artifact:${artifactId}`;
export const personKey = (name: string) => `person:${name}`;
export const systemKey = (name: string) => `system:${name}`;

/** Simulation nodes say kind 'person' | 'system' | 'ticket'; graph views say the label. */
const LABEL_BY_KIND: Record<string, string> = { person: "Person", system: "System", ticket: "Ticket" };

/**
 * One key per real thing, whichever tool returned it: who_knows gives database ids
 * (numbers), simulate_departure gives "person:Ada" or "ticket:T-9". Artifacts are keyed
 * by artifact id, people and systems by name, anything else by its raw id.
 */
function canonicalKey(label: string, name: string, artifactId: string | null, rawId: string): string {
  if (artifactId) return artifactKey(artifactId);
  if (label === "Person") return personKey(name);
  if (label === "System") return systemKey(name);
  return `node:${rawId}`;
}

function readNode(raw: unknown): (CanvasNode & { rawId: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (node.id === undefined || node.id === null) return null;
  const rawId = String(node.id);
  const label =
    typeof node.label === "string" ? node.label : (LABEL_BY_KIND[String(node.kind)] ?? "Node");
  const name = typeof node.name === "string" ? node.name : rawId;
  const artifactId = typeof node.artifactId === "string" ? node.artifactId : null;
  return { key: canonicalKey(label, name, artifactId, rawId), label, name, artifactId, rawId };
}

/** Merges graph paths from any tool into one canvas graph, deduplicating nodes and edges. */
export function toCanvasGraph(paths: readonly (GraphPath | GraphView | null | undefined)[]): CanvasGraph {
  const nodes = new Map<string, CanvasNode>();
  const edges = new Map<string, CanvasEdge>();
  for (const path of paths) {
    if (!path) continue;
    // Edges refer to the tool's raw ids; map them to canonical keys first.
    const keyOf = new Map<string, string>();
    for (const raw of path.nodes) {
      const node = readNode(raw);
      if (!node) continue;
      keyOf.set(node.rawId, node.key);
      if (!nodes.has(node.key)) nodes.set(node.key, { key: node.key, label: node.label, name: node.name, artifactId: node.artifactId });
    }
    for (const raw of path.edges) {
      if (!raw || typeof raw !== "object") continue;
      const edge = raw as Record<string, unknown>;
      const source = keyOf.get(String(edge.source));
      const target = keyOf.get(String(edge.target));
      if (!source || !target) continue;
      const type = typeof edge.type === "string" ? edge.type : "";
      edges.set(`${source}|${type}|${target}`, { source, target, type });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Keys of nodes from simulation paths flagged as orphaned (they turn red). */
export function orphanedKeys(paths: readonly (GraphPath | null | undefined)[]): string[] {
  const keys: string[] = [];
  for (const path of paths) {
    for (const raw of path?.nodes ?? []) {
      const node = readNode(raw);
      if (node && (raw as { orphaned?: unknown }).orphaned === true) keys.push(node.key);
    }
  }
  return keys;
}
