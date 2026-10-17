// Cypher for departure simulations. The live graph (apex) is only read here;
// every write happens in a scratch GRAPH.COPY of apex_proj (apex_whatif_<id>).

/**
 * K9. Knowledge islands: systems in a connected component (over KNOWS) that
 * contains no person, i.e. nobody knows them at all ({orphanedSystem}).
 * Run on apex_proj (before) and on the scratch copy (after). As in the spec.
 */
export const K9_KNOWLEDGE_ISLANDS = `
  CALL algo.WCC({nodeLabels:['Person','System'], relationshipTypes:['KNOWS']})
  YIELD node, componentId
  WITH componentId, collect(node) AS members
  WHERE all(m IN members WHERE m:System)
  UNWIND members AS orphan
  RETURN orphan.name AS orphanedSystem
`;

/**
 * The simulated departure, in the scratch copy only: the person and all their
 * edges (KNOWS, COLLAB) go, so no rebuild of COLLAB is needed.
 */
export const REMOVE_PERSON = `
  MATCH (p:Person {name: $person})
  DETACH DELETE p
`;

/** The person's KNOWS on $systems in the projection ({system, score, evidence}): evidence for islands. */
export const LEAVER_KNOWS = `
  MATCH (:Person {name: $person})-[k:KNOWS]->(s:System)
  WHERE s.name IN $systems
  RETURN s.name AS system, k.score AS score, k.evidence AS evidence
  ORDER BY system
`;

/**
 * K5 for every active person at once (apex): how many core systems each one is
 * the only expert on (same rules as K5: the leaver must be an expert, and backups are
 * measured against the top score of the people who remain),
 * with up to 10 of those systems and one evidence id each. Top 10 people
 * ({person, dept, orphaned, systems, evidence}).
 */
export const DEPARTURE_CANDIDATES = `
  MATCH (leaver:Person {active: true})-[k:KNOWS]->(s:System)
  WHERE s.core = true AND k.score >= $minScore
  OPTIONAL MATCH (s)<-[kt:KNOWS]-(:Person {active: true})
  WITH leaver, k, s, max(kt.score) AS top
  WHERE k.score >= $topShare * top
  OPTIONAL MATCH (s)<-[kl:KNOWS]-(left:Person {active: true})
  WHERE left <> leaver
  WITH leaver, k, s, max(kl.score) AS topLeft
  OPTIONAL MATCH (s)<-[k2:KNOWS]-(other:Person {active: true})
  WHERE other <> leaver AND k2.score >= $minScore AND k2.score >= $topShare * topLeft
  WITH leaver, s, k, count(other) AS backups
  WHERE backups = 0
  WITH leaver, s, k ORDER BY k.score DESC
  WITH leaver, count(s) AS orphaned, collect(s.name)[0..10] AS systems, collect(k.evidence[0])[0..10] AS evidence
  RETURN leaver.name AS person, leaver.dept AS dept, orphaned, systems, evidence
  ORDER BY orphaned DESC, person
  LIMIT 10
`;

/**
 * A person's open tickets ({ticket, title}), newest first: the ticket nodes of the
 * before-subgraph the web app shows ahead of a simulation. Open has the same meaning
 * as in K6: the status (on the ticket or the ASSIGNED edge) is not a done status,
 * and a missing status counts as open. Pass $doneStatuses in lower case.
 */
export const OPEN_TICKETS_OF = `
  MATCH (:Person {name:$person})-[asg:ASSIGNED]->(t:Ticket)
  WHERE NOT toLower(coalesce(t.status, asg.status, 'unknown')) IN $doneStatuses
  RETURN DISTINCT t.id AS ticket, t.title AS title, t.day AS day
  ORDER BY day DESC
`;
