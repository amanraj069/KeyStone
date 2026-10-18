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
