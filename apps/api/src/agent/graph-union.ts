import type { GraphPath } from './agent.types';

/**
 * The union of several graphPaths: nodes by id, edges by (source, target, type).
 * Node ids differ per tool (numbers from who_knows, strings like "person:Ada"
 * from simulate_departure), so they are compared as strings.
 */
export function unionGraphPaths(paths: readonly (GraphPath | null | undefined)[]): GraphPath {
  const nodes = new Map<string, unknown>();
  const edges = new Map<string, unknown>();
  for (const path of paths) {
    if (!path) continue;
    for (const node of path.nodes) nodes.set(String((node as { id?: unknown }).id ?? JSON.stringify(node)), node);
    for (const edge of path.edges) {
      const e = edge as { source?: unknown; target?: unknown; type?: unknown };
      edges.set(`${String(e.source)}|${String(e.target)}|${String(e.type)}`, edge);
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
