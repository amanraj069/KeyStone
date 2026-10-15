/**
 * Converts falkordb query results into plain, JSON-friendly objects the API can
 * send to the web app.
 *
 * The falkordb client (6.x) already returns plain objects. Their shapes, as
 * logged from the local container in Stage 3:
 *   node: { id, labels: string[], properties: {...} }
 *   edge: { id, relationshipType, sourceId, destinationId, properties: {...} }
 *   path: { nodes: node[], edges: edge[] }
 * Maps, lists and scalars come back as ordinary JS values.
 *
 * We normalise edges to { id, type, source, target, properties }, which is what
 * react-force-graph expects, and walk into lists/maps so nested values are
 * converted too.
 */

export interface GraphNode {
  id: number;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: number;
  type: string;
  source: number;
  target: number;
  properties: Record<string, unknown>;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly the keys the client uses for a node. */
function isRawNode(value: unknown): value is { id: number; labels: string[]; properties: RawObject } {
  return (
    isObject(value) &&
    hasExactKeys(value, ['id', 'labels', 'properties']) &&
    typeof value.id === 'number' &&
    Array.isArray(value.labels) &&
    isObject(value.properties)
  );
}

/** Exactly the keys the client uses for an edge. */
function isRawEdge(value: unknown): value is {
  id: number;
  relationshipType: string;
  sourceId: number;
  destinationId: number;
  properties: RawObject;
} {
  return (
    isObject(value) &&
    hasExactKeys(value, ['id', 'relationshipType', 'sourceId', 'destinationId', 'properties']) &&
    typeof value.relationshipType === 'string'
  );
}

/** A path has exactly nodes + edges, and every element really is a node / edge. */
function isRawPath(value: unknown): value is { nodes: unknown[]; edges: unknown[] } {
  return (
    isObject(value) &&
    hasExactKeys(value, ['nodes', 'edges']) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    value.nodes.every(isRawNode) &&
    value.edges.every(isRawEdge)
  );
}

function hasExactKeys(value: RawObject, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

/** Converts one result value (scalar, list, map, node, edge or path), recursively. */
export function toPlain(value: unknown): unknown {
  if (isRawNode(value)) {
    return { id: value.id, labels: [...value.labels], properties: toPlainMap(value.properties) } satisfies GraphNode;
  }
  if (isRawEdge(value)) {
    return {
      id: value.id,
      type: value.relationshipType,
      source: value.sourceId,
      target: value.destinationId,
      properties: toPlainMap(value.properties),
    } satisfies GraphEdge;
  }
  if (isRawPath(value)) {
    return { nodes: value.nodes.map(toPlain), edges: value.edges.map(toPlain) } as GraphPath;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (isObject(value)) return toPlainMap(value);
  return value;
}

function toPlainMap(map: RawObject): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, toPlain(value)]));
}

/**
 * Converts every row. The generic `T` is the caller's promise about the row
 * shape (e.g. { person: GraphNode; score: number }); it is not checked at
 * runtime. Validate with Zod where the data crosses a trust boundary.
 */
export function mapRows<T>(rows: readonly unknown[]): T[] {
  return rows.map((row) => toPlain(row) as T);
}
