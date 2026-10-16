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

/** People connected to Ticket, Page and Thread artifacts: what FalkorDB Browser should show after ingest. */
export const PEOPLE_TO_TICKETS_PAGES_THREADS = `
  MATCH (p:Person)-[r:AUTHORED|REVIEWED|ASSIGNED]->(a:Artifact)
  WHERE a:Ticket OR a:Page OR a:Thread
  RETURN p.name AS person, type(r) AS rel, a.id AS artifact
  ORDER BY person, artifact
`;

/** Every Artifact -> Artifact link with its type and kind. */
export const ARTIFACT_LINKS = `
  MATCH (a:Artifact)-[r:REFERENCES|FIXES]->(b:Artifact)
  RETURN a.id AS from, type(r) AS rel, r.kind AS kind, b.id AS to
  ORDER BY from, to
`;

/** Each person's department edge and activity days. */
export const PEOPLE_SUMMARY = `
  MATCH (p:Person)
  OPTIONAL MATCH (p)-[:MEMBER_OF]->(d:Dept)
  RETURN p.name AS name, d.name AS dept, p.firstDay AS firstDay, p.lastSeenDay AS lastSeenDay, p.active AS active
  ORDER BY name
`;

/**
 * Retrieval fixture: A -REFERENCES-> B -REFERENCES-> D (so D is 2 hops from A),
 * C is unlinked; Ada wrote A. Days: A 5, B 2, C 1, D 3.
 */
export const RETRIEVAL_FIXTURE = `
  CREATE (ada:Person {name: 'Ada'}),
    (a:Artifact:Page {id: 'A', title: 'TitanDB runbook', type: 'confluence', day: 5}),
    (b:Artifact:Ticket {id: 'B', title: 'TitanDB backup bug', type: 'jira', day: 2}),
    (c:Artifact:Thread {id: 'C', title: 'Lunch plans', type: 'slack', day: 1}),
    (d:Artifact:Email {id: 'D', title: 'Vendor reply', type: 'email', day: 3}),
    (ada)-[:AUTHORED {day: 5}]->(a),
    (a)-[:REFERENCES {kind: 'jira'}]->(b),
    (b)-[:REFERENCES {kind: 'source_email'}]->(d)
`;

/** Chunk nodes with their artifact, and whether any chunk carries text (it must not). */
export const CHUNK_SUMMARY = `
  MATCH (c:Chunk)-[:PART_OF]->(a:Artifact)
  RETURN count(c) AS chunks, count(DISTINCT a) AS artifacts,
         sum(CASE WHEN c.text IS NULL THEN 0 ELSE 1 END) AS withText
`;

/**
 * Replay test: gives D-1 a source artifact (T-1, day 3), as every real decision
 * has one, so SUPERSEDES and ASSERTS can be replayed.
 */
export const GIVE_D1_A_SOURCE = `
  MATCH (d:Decision {id: 'D-1'}), (a:Artifact {id: 'T-1'})
  MERGE (d)-[:DECIDED_IN]->(a)
`;

/** What extraction wrote: counts of systems, mentions, decisions, links and superseded decisions. */
export const EXTRACTION_SUMMARY = `
  OPTIONAL MATCH (s:System) WITH count(s) AS systems
  OPTIONAL MATCH ()-[m:MENTIONS]->() WITH systems, count(m) AS mentions
  OPTIONAL MATCH (d:Decision) WITH systems, mentions, count(d) AS decisions,
       sum(CASE WHEN d.status = 'superseded' THEN 1 ELSE 0 END) AS superseded
  OPTIONAL MATCH ()-[x:SUPERSEDES]->() WITH systems, mentions, decisions, superseded, count(x) AS supersedes
  OPTIONAL MATCH ()-[y:ASSERTS]->() WITH systems, mentions, decisions, superseded, supersedes, count(y) AS asserts
  OPTIONAL MATCH ()-[z:ABOUT]->()
  RETURN systems, mentions, decisions, superseded, supersedes, asserts, count(z) AS about
`;

/** KNOWS edges as {person, system, score} (to compare two graphs). */
export const ALL_KNOWS = `
  MATCH (p:Person)-[k:KNOWS]->(s:System)
  RETURN p.name AS person, s.name AS system, k.score AS score
  ORDER BY person, system
`;

/** COLLAB pairs in a projection, one row per pair ({a, b, weight}). */
export const PROJECTION_COLLAB_PAIRS = `
  MATCH (a:Person)-[c:COLLAB]->(b:Person)
  WHERE a.name < b.name
  RETURN a.name AS a, b.name AS b, c.weight AS weight
  ORDER BY a, b
`;
