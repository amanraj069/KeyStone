// Cypher used only by integration tests (kept in one place, like app queries).

/** One row per label with how many nodes carry it. Proves the fixture loaded. */
export const COUNT_NODES_BY_LABEL = `
  MATCH (n) UNWIND labels(n) AS label
  RETURN label, count(*) AS count
  ORDER BY label
`;

/** Artifacts visible "as of" $day. Artifacts with day: null must not match. */
export const ARTIFACTS_AS_OF_DAY = `
  MATCH (a:Artifact) WHERE a.day <= $day
  RETURN a.id AS id ORDER BY id
`;

/** Writes one :BatchProbe node per row; used to test batchWrite. */
export const WRITE_BATCH_PROBES = 'UNWIND $rows AS row CREATE (:BatchProbe {n: row.n, label: row.label})';

/** Count and sum of the probe nodes, so a lost or duplicated batch is detected. */
export const COUNT_BATCH_PROBES = 'MATCH (b:BatchProbe) RETURN count(b) AS count, sum(b.n) AS total';

/** One node: Ada. */
export const ADA_NODE = "MATCH (p:Person {name: 'Ada'}) RETURN p";

/** One edge: Ada's AUTHORED edge to T-1. */
export const ADA_AUTHORED_T1 = "MATCH (:Person {name: 'Ada'})-[r:AUTHORED]->(:Artifact {id: 'T-1'}) RETURN r";

/** One path: D-2 -[:SUPERSEDES]-> D-1. */
export const SUPERSEDES_PATH = "MATCH path = (:Decision {id: 'D-2'})-[:SUPERSEDES]->(:Decision {id: 'D-1'}) RETURN path";

/**
 * Active experts per system: active people who AUTHORED, REVIEWED or were
 * ASSIGNED an artifact that MENTIONS the system. Checks the fixture's design.
 */
export const ACTIVE_EXPERTS_BY_SYSTEM = `
  MATCH (s:System)
  OPTIONAL MATCH (s)<-[:MENTIONS]-(:Artifact)<-[:AUTHORED|REVIEWED|ASSIGNED]-(p:Person {active: true})
  WITH s, collect(DISTINCT p.name) AS experts
  RETURN s.name AS system, experts ORDER BY system
`;

/** People who collaborated (touched the same artifact) with someone from another department. */
export const CROSS_DEPT_COLLABORATORS = `
  MATCH (a:Person)-[:AUTHORED|REVIEWED|ASSIGNED]->(:Artifact)<-[:AUTHORED|REVIEWED|ASSIGNED]-(b:Person)
  WHERE a.dept <> b.dept
  RETURN a.name AS person, collect(DISTINCT b.name) AS partners ORDER BY person
`;
