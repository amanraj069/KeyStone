// Cypher for backups, the actions export and the seed command's restore of actions.
// Backups themselves are GRAPH.COPY / GRAPH.DELETE commands (GraphService), not Cypher.

/**
 * How many Person nodes the graph has ({people}).
 * Why: a graph with no people is "missing" for every safety check here. SchemaService
 * creates an empty apex (indexes only) at startup, so "the graph exists" is not enough:
 * startup restores or seeds it, and backups and exports refuse to overwrite good copies with it.
 */
export const PERSON_COUNT = 'MATCH (p:Person) RETURN count(p) AS people';

/**
 * One page of Action nodes (ordered by id, $skip / $limit), each with its edges:
 * every property of the action ({id, props}), what it TARGETS (targetType: the
 * label without "Artifact", e.g. Ticket, Page, System, Person; target: its id or
 * name), who it ASSIGNS_TO, the plan it is PART_OF_PLAN, and its BASED_ON artifact ids.
 * Why: the 6-hourly export, so approvals survive a rebuild of the graph from files.
 */
export const EXPORT_ACTIONS = `
  MATCH (act:Action)
  WITH act ORDER BY act.id SKIP $skip LIMIT $limit
  OPTIONAL MATCH (act)-[:TARGETS]->(target)
  OPTIONAL MATCH (act)-[:ASSIGNS_TO]->(who:Person)
  OPTIONAL MATCH (act)-[:PART_OF_PLAN]->(plan:Action)
  OPTIONAL MATCH (act)-[:BASED_ON]->(e:Artifact)
  WITH act, target, who, plan, collect(DISTINCT e.id) AS basedOn
  RETURN act.id AS id, properties(act) AS props,
         CASE WHEN target IS NULL THEN NULL ELSE [l IN labels(target) WHERE l <> 'Artifact'][0] END AS targetType,
         coalesce(target.id, target.name) AS target,
         who.name AS assignsTo, plan.id AS partOfPlan, basedOn
  ORDER BY id
`;

/**
 * Restores exported Action nodes ($rows of {id, props}). A new action gets every
 * exported property. An existing one is only updated while it is still "proposed":
 * approved and rejected are final, so an older export can never undo a decision.
 * Why: the seed command (and a restore from apex_backup) bring back the actions.
 */
export const RESTORE_ACTION_NODES = `
  UNWIND $rows AS row
  MERGE (act:Action {id: row.id})
  WITH act, row
  WHERE act.status IS NULL OR act.status = 'proposed'
  SET act += row.props
`;

/**
 * Re-creates each restored action's edges ($rows of {id, targetType, target,
 * assignsTo, partOfPlan, basedOn}) with MERGE, so running it twice adds nothing.
 * Targets are matched by label (Ticket and Page by id, System and Person by name).
 * Returns {id, targetFound, evidence}: targetFound is false when the rebuilt graph
 * no longer has the target (e.g. a renamed system), evidence = BASED_ON edges linked.
 * Run after RESTORE_ACTION_NODES, so every plan an action points to exists.
 */
export const RESTORE_ACTION_EDGES = `
  UNWIND $rows AS row
  MATCH (act:Action {id: row.id})
  OPTIONAL MATCH (ticket:Ticket {id: row.target}) WHERE row.targetType = 'Ticket'
  OPTIONAL MATCH (page:Page {id: row.target}) WHERE row.targetType = 'Page'
  OPTIONAL MATCH (system:System {name: row.target}) WHERE row.targetType = 'System'
  OPTIONAL MATCH (person:Person {name: row.target}) WHERE row.targetType = 'Person'
  OPTIONAL MATCH (who:Person {name: row.assignsTo})
  OPTIONAL MATCH (plan:Action {id: row.partOfPlan})
  FOREACH (x IN CASE WHEN ticket IS NULL THEN [] ELSE [ticket] END | MERGE (act)-[:TARGETS]->(x))
  FOREACH (x IN CASE WHEN page IS NULL THEN [] ELSE [page] END | MERGE (act)-[:TARGETS]->(x))
  FOREACH (x IN CASE WHEN system IS NULL THEN [] ELSE [system] END | MERGE (act)-[:TARGETS]->(x))
  FOREACH (x IN CASE WHEN person IS NULL THEN [] ELSE [person] END | MERGE (act)-[:TARGETS]->(x))
  FOREACH (x IN CASE WHEN who IS NULL THEN [] ELSE [who] END | MERGE (act)-[:ASSIGNS_TO]->(x))
  FOREACH (x IN CASE WHEN plan IS NULL THEN [] ELSE [plan] END | MERGE (act)-[:PART_OF_PLAN]->(x))
  WITH act, row, ticket IS NOT NULL OR page IS NOT NULL OR system IS NOT NULL OR person IS NOT NULL AS targetFound
  UNWIND CASE WHEN size(row.basedOn) = 0 THEN [null] ELSE row.basedOn END AS eid
  OPTIONAL MATCH (e:Artifact {id: eid})
  WITH act, row, targetFound, collect(e) AS evidence
  FOREACH (x IN evidence | MERGE (act)-[:BASED_ON]->(x))
  RETURN row.id AS id, targetFound, size(evidence) AS evidence
`;

/**
 * Approved reassignments in the order they were approved ({id}).
 * Why: approving one moved a ticket's ASSIGNED edge; a graph rebuilt from files has
 * the original owners again, so each move is re-applied in the same order.
 */
export const APPROVED_REASSIGNMENTS = `
  MATCH (act:Action {kind: 'reassign', status: 'approved'})
  RETURN act.id AS id
  ORDER BY act.approvedAt, act.id
`;

/**
 * Re-applies one approved reassignment ($id), exactly like APPROVE_ACTION did:
 * the replaced owner's ASSIGNED edge is deleted (every other owner's when
 * fromPerson is null) and the new owner's edge is merged with day = approvedDay
 * and via = the action id, keeping the old status ({id, moved}). Running it again
 * changes nothing. No row: the action, its ticket or its assignee is missing.
 */
export const REAPPLY_APPROVED_REASSIGNMENT = `
  MATCH (act:Action {id: $id, kind: 'reassign', status: 'approved'})-[:TARGETS]->(t:Ticket)
  MATCH (act)-[:ASSIGNS_TO]->(p:Person)
  OPTIONAL MATCH (old:Person)-[a:ASSIGNED]->(t)
  WHERE old <> p AND (act.fromPerson IS NULL OR old.name = act.fromPerson)
  WITH act, t, p, collect(a) AS olds, head(collect(a.status)) AS status
  FOREACH (x IN olds | DELETE x)
  MERGE (p)-[n:ASSIGNED]->(t)
  SET n.day = act.approvedDay, n.via = act.id, n.status = coalesce(n.status, status)
  RETURN act.id AS id, size(olds) AS moved
`;

// ---------------------------------------------------------------- memory (Stage 16)
// The agent's memory (User, Session, Turn, Feedback, Note) is made by people, like
// Actions, so it cannot be rebuilt from artifacts.jsonl: it is exported to
// exports/memory-latest.jsonl and put back by the seed and by a restore.

/**
 * Every memory node, page by page, with its outgoing edges ({label, id, props, edges}).
 * Each edge names its end by kind and key: memory nodes and artifacts by id, systems
 * and people by name, so they can be linked again in a rebuilt graph.
 */
export const EXPORT_MEMORY = `
  MATCH (x)
  WHERE x:User OR x:Session OR x:Turn OR x:Feedback OR x:Note
  WITH x ORDER BY x.id SKIP $skip LIMIT $limit
  OPTIONAL MATCH (x)-[r]->(y)
  WITH x, collect(CASE WHEN y IS NULL THEN NULL ELSE {
         type: type(r),
         toKind: CASE WHEN y:Artifact THEN 'Artifact' WHEN y:System THEN 'System' WHEN y:Person THEN 'Person' ELSE labels(y)[0] END,
         to: CASE WHEN y:System OR y:Person THEN y.name ELSE y.id END
       } END) AS edges
  RETURN CASE WHEN x:User THEN 'User' WHEN x:Session THEN 'Session' WHEN x:Turn THEN 'Turn' WHEN x:Feedback THEN 'Feedback' ELSE 'Note' END AS label,
         x.id AS id, properties(x) AS props, edges
`;

/**
 * Restores memory nodes of one label ($rows of {id, props}) with MERGE, so running it
 * twice adds nothing. A note already approved or rejected keeps its decision: an
 * older export can never send it back to "proposed".
 */
const restoreMemoryNodes = (label: string) => `
  UNWIND $rows AS row
  MERGE (x:${label} {id: row.id})
  WITH x, row
  WHERE NOT (coalesce(x.status, '') IN ['approved', 'rejected'] AND coalesce(row.props.status, '') = 'proposed')
  SET x += row.props
`;

export const RESTORE_MEMORY_NODES = {
  User: restoreMemoryNodes('User'),
  Session: restoreMemoryNodes('Session'),
  Turn: restoreMemoryNodes('Turn'),
  Feedback: restoreMemoryNodes('Feedback'),
  Note: restoreMemoryNodes('Note'),
} as const;

/**
 * Re-creates one kind of memory edge ($rows of {from, to}) with MERGE. Ends that the
 * rebuilt graph no longer has (an artifact or system that is gone) are skipped.
 * Labels and types come only from the fixed table below, never from input.
 */
const restoreMemoryEdge = (from: string, type: string, to: string, toKey: 'id' | 'name') => `
  UNWIND $rows AS row
  MATCH (a:${from} {id: row.from})
  MATCH (b:${to} {${toKey}: row.to})
  MERGE (a)-[:${type}]->(b)
`;

/** Every memory edge, keyed "<from label>|<type>|<to kind>" as EXPORT_MEMORY names them. */
export const RESTORE_MEMORY_EDGES: Record<string, string> = {
  'User|STARTED|Session': restoreMemoryEdge('User', 'STARTED', 'Session', 'id'),
  'User|GAVE|Feedback': restoreMemoryEdge('User', 'GAVE', 'Feedback', 'id'),
  'User|WROTE|Note': restoreMemoryEdge('User', 'WROTE', 'Note', 'id'),
  'Session|HAS_TURN|Turn': restoreMemoryEdge('Session', 'HAS_TURN', 'Turn', 'id'),
  'Turn|NEXT|Turn': restoreMemoryEdge('Turn', 'NEXT', 'Turn', 'id'),
  'Turn|CITED|Artifact': restoreMemoryEdge('Turn', 'CITED', 'Artifact', 'id'),
  'Turn|CONCERNS|System': restoreMemoryEdge('Turn', 'CONCERNS', 'System', 'name'),
  'Turn|CONCERNS|Person': restoreMemoryEdge('Turn', 'CONCERNS', 'Person', 'name'),
  'Feedback|ON|Turn': restoreMemoryEdge('Feedback', 'ON', 'Turn', 'id'),
  'Note|CORRECTS|Turn': restoreMemoryEdge('Note', 'CORRECTS', 'Turn', 'id'),
  'Note|BASED_ON|Artifact': restoreMemoryEdge('Note', 'BASED_ON', 'Artifact', 'id'),
  'Note|CONCERNS|System': restoreMemoryEdge('Note', 'CONCERNS', 'System', 'name'),
  'Note|CONCERNS|Person': restoreMemoryEdge('Note', 'CONCERNS', 'Person', 'name'),
};
