// Cypher for proposed actions: what Keystone suggests and a human approves.
// Every action is an (:Action) node with the evidence it was based on, so the
// graph itself is the audit trail (see WHY_SUGGESTED).
//
// Shared by the CREATE queries: $planId (null, or the handover plan the action
// belongs to) and $evidenceIds (artifact ids). Ids that match no Artifact are
// skipped; an empty list is turned into [null] so the query still returns its row.

/**
 * createReassignProposal: a proposal to move Ticket $ticketId to Person $person
 * ({id, evidence}: the action id and how many BASED_ON edges were created).
 * $fromPerson (or null) is the owner being replaced; approval moves only that
 * person's ASSIGNED edge (all other owners when null).
 */
export const CREATE_REASSIGN_PROPOSAL = `
  MATCH (t:Ticket {id: $ticketId}), (p:Person {name: $person})
  OPTIONAL MATCH (plan:Action {id: $planId})
  CREATE (act:Action {id: $id, kind: 'reassign', status: 'proposed', day: $today, reason: $reason,
                      createdBy: $createdBy, createdAt: $createdAt, fromPerson: $fromPerson}),
         (act)-[:TARGETS]->(t), (act)-[:ASSIGNS_TO]->(p)
  FOREACH (x IN CASE WHEN plan IS NULL THEN [] ELSE [plan] END | CREATE (act)-[:PART_OF_PLAN]->(x))
  WITH act
  UNWIND CASE WHEN size($evidenceIds) = 0 THEN [null] ELSE $evidenceIds END AS eid
  OPTIONAL MATCH (e:Artifact {id: eid})
  WITH act, collect(e) AS evidence
  FOREACH (x IN evidence | CREATE (act)-[:BASED_ON]->(x))
  RETURN act.id AS id, size(evidence) AS evidence
`;

/**
 * createRunbookTask: a task to write or update System $system's runbook, for
 * $assignee (its current sole expert; null when nobody knows it), based on the
 * bus-factor evidence ({id, evidence}).
 */
export const CREATE_RUNBOOK_TASK = `
  MATCH (s:System {name: $system})
  OPTIONAL MATCH (p:Person {name: $assignee})
  OPTIONAL MATCH (plan:Action {id: $planId})
  CREATE (act:Action {id: $id, kind: 'runbook', status: 'proposed', day: $today, reason: $reason,
                      createdBy: $createdBy, createdAt: $createdAt}),
         (act)-[:TARGETS]->(s)
  FOREACH (x IN CASE WHEN p IS NULL THEN [] ELSE [p] END | CREATE (act)-[:ASSIGNS_TO]->(x))
  FOREACH (x IN CASE WHEN plan IS NULL THEN [] ELSE [plan] END | CREATE (act)-[:PART_OF_PLAN]->(x))
  WITH act
  UNWIND CASE WHEN size($evidenceIds) = 0 THEN [null] ELSE $evidenceIds END AS eid
  OPTIONAL MATCH (e:Artifact {id: eid})
  WITH act, collect(e) AS evidence
  FOREACH (x IN evidence | CREATE (act)-[:BASED_ON]->(x))
  RETURN act.id AS id, size(evidence) AS evidence
`;

/** A task for $assignee (or nobody) to review Page $pageId, which only the leaver wrote ({id, evidence}). */
export const CREATE_REVIEW_DOC_TASK = `
  MATCH (pg:Page {id: $pageId})
  OPTIONAL MATCH (p:Person {name: $assignee})
  OPTIONAL MATCH (plan:Action {id: $planId})
  CREATE (act:Action {id: $id, kind: 'review_doc', status: 'proposed', day: $today, reason: $reason,
                      createdBy: $createdBy, createdAt: $createdAt}),
         (act)-[:TARGETS]->(pg)
  FOREACH (x IN CASE WHEN p IS NULL THEN [] ELSE [p] END | CREATE (act)-[:ASSIGNS_TO]->(x))
  FOREACH (x IN CASE WHEN plan IS NULL THEN [] ELSE [plan] END | CREATE (act)-[:PART_OF_PLAN]->(x))
  WITH act
  UNWIND CASE WHEN size($evidenceIds) = 0 THEN [null] ELSE $evidenceIds END AS eid
  OPTIONAL MATCH (e:Artifact {id: eid})
  WITH act, collect(e) AS evidence
  FOREACH (x IN evidence | CREATE (act)-[:BASED_ON]->(x))
  RETURN act.id AS id, size(evidence) AS evidence
`;

/**
 * createHandoverPlan: the parent action of a handover, targeting the departing
 * Person, with a human-readable $summary. Its reassign, review_doc and runbook
 * children are created with $planId set to this plan's id ({id, evidence}).
 */
export const CREATE_HANDOVER_PLAN = `
  MATCH (leaver:Person {name: $person})
  CREATE (plan:Action {id: $id, kind: 'handover', status: 'proposed', day: $today, reason: $reason, summary: $summary,
                       createdBy: $createdBy, createdAt: $createdAt}),
         (plan)-[:TARGETS]->(leaver)
  WITH plan
  UNWIND CASE WHEN size($evidenceIds) = 0 THEN [null] ELSE $evidenceIds END AS eid
  OPTIONAL MATCH (e:Artifact {id: eid})
  WITH plan, collect(e) AS evidence
  FOREACH (x IN evidence | CREATE (plan)-[:BASED_ON]->(x))
  RETURN plan.id AS id, size(evidence) AS evidence
`;

/**
 * An open (proposed) action of $kind that already targets $target (a ticket or
 * page id, or a system or person name) ({id}): used to refuse duplicates.
 */
export const OPEN_ACTION_FOR_TARGET = `
  MATCH (act:Action {kind: $kind, status: 'proposed'})-[:TARGETS]->(target)
  WHERE coalesce(target.id, target.name) = $target
  RETURN act.id AS id
  ORDER BY act.createdAt
  LIMIT 1
`;

/**
 * approve: a proposed action becomes approved (approvedAt, approvedDay). For a
 * reassign it also moves the ticket, in the same statement: the replaced owner's
 * ASSIGNED edge is deleted (every other owner's when fromPerson is null) and the
 * new owner gets one with day = today and via = the action id, keeping the old
 * status ({id, kind, moved}: moved = ASSIGNED edges removed). No row: not proposed.
 */
export const APPROVE_ACTION = `
  MATCH (act:Action {id: $id})
  WHERE act.status = 'proposed'
  SET act.status = 'approved', act.approvedAt = $now, act.approvedDay = $today
  WITH act
  OPTIONAL MATCH (act)-[:TARGETS]->(t:Ticket)
  OPTIONAL MATCH (act)-[:ASSIGNS_TO]->(p:Person)
  OPTIONAL MATCH (old:Person)-[a:ASSIGNED]->(t)
  WHERE act.kind = 'reassign' AND old <> p AND (act.fromPerson IS NULL OR old.name = act.fromPerson)
  WITH act, t, p, collect(a) AS olds, head(collect(a.status)) AS status
  FOREACH (x IN olds | DELETE x)
  FOREACH (_ IN CASE WHEN act.kind = 'reassign' AND t IS NOT NULL AND p IS NOT NULL THEN [1] ELSE [] END |
    MERGE (p)-[n:ASSIGNED]->(t)
    SET n.day = $today, n.via = act.id, n.status = coalesce(n.status, status))
  RETURN act.id AS id, act.kind AS kind, size(olds) AS moved
`;

/** reject: a proposed action becomes rejected, with the reviewer's $reason ({id}). No row: not proposed. */
export const REJECT_ACTION = `
  MATCH (act:Action {id: $id})
  WHERE act.status = 'proposed'
  SET act.status = 'rejected', act.rejectedAt = $now, act.rejectReason = $reason
  RETURN act.id AS id
`;

/** The status of one action ({status}); no row if it does not exist. */
export const ACTION_STATUS = 'MATCH (act:Action {id: $id}) RETURN act.status AS status';

/**
 * listActions: actions newest first, optionally only one $status, one $id or the
 * children of one $planId, each with its target (type, key, title), assignee,
 * plan, children and the BASED_ON artifacts (id, title, type), at most $limit.
 */
export const LIST_ACTIONS = `
  MATCH (act:Action)
  WHERE ($status IS NULL OR act.status = $status) AND ($id IS NULL OR act.id = $id)
  OPTIONAL MATCH (act)-[:PART_OF_PLAN]->(plan:Action)
  WITH act, plan
  WHERE $planId IS NULL OR plan.id = $planId
  OPTIONAL MATCH (act)-[:TARGETS]->(target)
  OPTIONAL MATCH (act)-[:ASSIGNS_TO]->(who:Person)
  OPTIONAL MATCH (act)-[:BASED_ON]->(e:Artifact)
  WITH act, target, who, plan,
       collect(DISTINCT CASE WHEN e IS NULL THEN NULL ELSE {id: e.id, title: e.title, type: e.type} END) AS evidence
  RETURN act.id AS id, act.kind AS kind, act.status AS status, act.day AS day, act.reason AS reason,
         act.summary AS summary, act.createdBy AS createdBy, act.createdAt AS createdAt,
         act.approvedAt AS approvedAt, act.rejectedAt AS rejectedAt, act.rejectReason AS rejectReason,
         [l IN labels(target) WHERE l <> 'Artifact'][0] AS targetType, coalesce(target.id, target.name) AS target,
         target.title AS targetTitle, who.name AS assignee, plan.id AS planId,
         [(child:Action)-[:PART_OF_PLAN]->(act) | child.id] AS children, evidence
  ORDER BY createdAt DESC, id
  LIMIT $limit
`;

/**
 * WHY_SUGGESTED, the audit trail of one action ($id) in one query: "why did
 * Keystone suggest this?" Returns the action (kind, status, reason, day, who
 * created and who approved or rejected it and when), what it targets and who it
 * assigns, the handover plan and departing person it is part of, every BASED_ON
 * artifact with its title, type, day and the people who wrote it, and the
 * assignee's own expertise (KNOWS score and evidence) on the systems the target
 * mentions, i.e. why this person.
 */
export const WHY_SUGGESTED = `
  MATCH (act:Action {id: $id})
  OPTIONAL MATCH (act)-[:TARGETS]->(target)
  OPTIONAL MATCH (act)-[:ASSIGNS_TO]->(who:Person)
  OPTIONAL MATCH (act)-[:PART_OF_PLAN]->(plan:Action)-[:TARGETS]->(leaver:Person)
  OPTIONAL MATCH (act)-[:BASED_ON]->(e:Artifact)
  WITH act, target, who, plan, leaver, e,
       [(e)<-[:AUTHORED|PARTICIPATED|REVIEWED]-(author:Person) | author.name] AS authors
  WITH act, target, who, plan, leaver,
       collect(DISTINCT CASE WHEN e IS NULL THEN NULL ELSE {id: e.id, title: e.title, type: e.type, day: e.day, authors: authors} END) AS basedOn
  OPTIONAL MATCH (target)-[:MENTIONS]->(s:System)<-[k:KNOWS]-(who)
  RETURN act.id AS id, act.kind AS kind, act.status AS status, act.reason AS reason, act.summary AS summary, act.day AS day,
         act.createdBy AS createdBy, act.createdAt AS createdAt, act.approvedAt AS approvedAt,
         act.rejectedAt AS rejectedAt, act.rejectReason AS rejectReason,
         [l IN labels(target) WHERE l <> 'Artifact'][0] AS targetType, coalesce(target.id, target.name) AS target,
         target.title AS targetTitle, who.name AS assignee, plan.id AS planId, leaver.name AS planFor, basedOn,
         collect(DISTINCT CASE WHEN s IS NULL THEN NULL ELSE {system: s.name, score: k.score, evidence: k.evidence} END) AS assigneeExpertise
`;

/** The assignee's KNOWS evidence on the systems Ticket $ticketId mentions, strongest first ({evidence}). */
export const REASSIGN_EVIDENCE = `
  MATCH (:Ticket {id: $ticketId})-[:MENTIONS]->(:System)<-[k:KNOWS]-(:Person {name: $person})
  WITH k ORDER BY k.score DESC
  RETURN collect(k.evidence) AS evidence
`;

/**
 * For each page in $pages: its main system (the MENTIONS with the highest weight)
 * and that system's strongest active expert other than $leaver, with their
 * evidence ({page, system, reviewer, evidence}); reviewer null when there is none.
 * The main system is carried by name and matched again: FalkorDB does not accept a
 * node taken out of a list (head(collect(s))) as a pattern variable.
 */
export const PAGE_REVIEWERS = `
  UNWIND $pages AS pageId
  MATCH (pg:Page {id: pageId})
  OPTIONAL MATCH (pg)-[m:MENTIONS]->(s:System)
  WITH pg, s, m ORDER BY m.weight DESC
  WITH pg, head(collect(s.name)) AS mainName
  OPTIONAL MATCH (main:System {name: mainName})
  OPTIONAL MATCH (main)<-[k:KNOWS]-(p:Person {active: true})
  WHERE p.name <> $leaver
  WITH pg, main, p, k ORDER BY k.score DESC
  WITH pg, main, head(collect(CASE WHEN p IS NULL THEN NULL ELSE {name: p.name, evidence: k.evidence} END)) AS best
  RETURN pg.id AS page, main.name AS system, best.name AS reviewer, coalesce(best.evidence, []) AS evidence
`;

/** Does Ticket $ticketId exist ({id, title})? */
export const TICKET_EXISTS = 'MATCH (t:Ticket {id: $ticketId}) RETURN t.id AS id, t.title AS title';

/**
 * The evidence graph of one action, as paths (one row each): the action's own edges
 * (TARGETS, ASSIGNS_TO, BASED_ON) and, for an action that targets an artifact, the
 * assignee's KNOWS edges to the systems that artifact mentions. The web app's Audit
 * canvas draws it; it is the graph form of WHY_SUGGESTED.
 */
export const ACTION_EVIDENCE_GRAPH = `
  MATCH (act:Action {id: $id})
  OPTIONAL MATCH own = (act)-[:TARGETS|ASSIGNS_TO|BASED_ON]->()
  WITH act, collect(own) AS ownPaths
  OPTIONAL MATCH (act)-[:TARGETS]->(target:Artifact), (act)-[:ASSIGNS_TO]->(who:Person)
  OPTIONAL MATCH knows = (target)-[:MENTIONS]->(:System)<-[:KNOWS]-(who)
  WITH ownPaths, collect(knows) AS knowsPaths
  UNWIND ownPaths + knowsPaths AS path
  RETURN path
`;
