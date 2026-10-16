import type { GraphPath } from '../graph/result-mapper';

/** A node for the web graph canvas (react-force-graph): stable id, label and a readable name. */
export interface ViewNode {
  id: number;
  label: string;
  name: string;
  /** Business id of an Artifact (its doc id), so the UI can cite it. */
  artifactId: string | null;
}

export interface ViewEdge {
  id: number;
  type: string;
  source: number;
  target: number;
}

export interface GraphView {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

/**
 * Merges several paths into one de-duplicated node/edge list. Labels: the most
 * specific one ("Ticket" rather than "Artifact"). Presentation only: no
 * aggregation happens here.
 */
export function pathsToGraphView(paths: readonly GraphPath[]): GraphView {
  const nodes = new Map<number, ViewNode>();
  const edges = new Map<number, ViewEdge>();
  for (const path of paths) {
    for (const node of path.nodes) {
      const props = node.properties as { name?: string; title?: string; id?: string };
      const label = node.labels.find((l) => l !== 'Artifact') ?? node.labels[0] ?? 'Node';
      const artifactId = node.labels.includes('Artifact') ? (props.id ?? null) : null;
      nodes.set(node.id, { id: node.id, label, name: props.name ?? props.title ?? props.id ?? String(node.id), artifactId });
    }
    for (const edge of path.edges) edges.set(edge.id, { id: edge.id, type: edge.type, source: edge.source, target: edge.target });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
