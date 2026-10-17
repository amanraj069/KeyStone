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
  MATCH (p:Person)-[r:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(a:Artifact)
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

/** System statistics written by the catalog ({name, mentionCount, authorCount, core, idf}). */
export const SYSTEM_STATS = `
  MATCH (s:System)
  RETURN s.name AS name, s.mentionCount AS mentionCount, s.authorCount AS authorCount, s.core AS core, s.idf AS idf
  ORDER BY name
`;

/**
 * A duplicate of TitanDB written differently ("TitanDB v2"): mentioned by P-1
 * (new for TitanDB, weight 5) and T-1 (already mentions TitanDB with weight 3),
 * and the subject of decision D-1.
 */
export const ADD_TITAN_DUPLICATE = `
  MATCH (p1:Artifact {id: 'P-1'}), (t1:Artifact {id: 'T-1'}), (d1:Decision {id: 'D-1'})
  CREATE (dup:System {name: 'TitanDB v2', aliases: ['titan v2']}),
         (p1)-[:MENTIONS {weight: 5}]->(dup), (t1)-[:MENTIONS {weight: 1}]->(dup), (d1)-[:ABOUT]->(dup)
`;

/** Where TitanDB's MENTIONS and ABOUT edges come from ({artifacts: [{id, weight}], decisions, aliases}). */
export const TITAN_EDGES = `
  MATCH (s:System {name: 'TitanDB'})
  OPTIONAL MATCH (a:Artifact)-[m:MENTIONS]->(s)
  WITH s, a, m ORDER BY a.id
  WITH s, collect({id: a.id, weight: m.weight}) AS artifacts
  OPTIONAL MATCH (d:Decision)-[:ABOUT]->(s)
  RETURN artifacts, collect(d.id) AS decisions, s.aliases AS aliases
`;

/**
 * Owner-fit test graph: Leaver owns open ticket T-9, which names a common system
 * (11 of 12 artifacts mention it, idf = ln(12/12) = 0) and a niche one (2 of 12,
 * idf = ln(12/3) = 1.39). Gen knows Common well (5.0); Spec knows Niche (2.0).
 * By raw score Gen fits better; weighted by idf, Spec does.
 */
export const IDF_FIXTURE = `
  CREATE (l:Person {name: 'Leaver', active: true}), (g:Person {name: 'Gen', active: true}),
         (sp:Person {name: 'Spec', active: true}),
         (c:System {name: 'Common'}), (n:System {name: 'Niche'}),
         (t:Artifact:Ticket {id: 'T-9', title: 'Fix niche export', day: 1}),
         (l)-[:ASSIGNED {day: 1, status: 'To Do'}]->(t),
         (t)-[:MENTIONS {weight: 1}]->(c), (t)-[:MENTIONS {weight: 1}]->(n),
         (:Artifact {id: 'N-1', day: 1})-[:MENTIONS {weight: 1}]->(n),
         (g)-[:KNOWS {score: 5.0, lastDay: 1, evidence: ['A-1']}]->(c),
         (sp)-[:KNOWS {score: 2.0, lastDay: 1, evidence: ['N-1']}]->(n)
  WITH c
  UNWIND range(1, 10) AS i
  CREATE (:Artifact {id: 'A-' + toString(i), day: 1})-[:MENTIONS {weight: 1}]->(c)
`;

/** Marks every System core (tests that need core systems without running the catalog). */
export const MARK_ALL_SYSTEMS_CORE = 'MATCH (s:System) SET s.core = true';

/**
 * Eve also took part in meeting M-1 with one message (0.125 in K2). Together with
 * T-3 (Eve AUTHORED, Dev ASSIGNED) that makes Dev and Eve share two artifacts.
 */
export const EVE_JOINS_MEETING = `
  MATCH (eve:Person {name: 'Eve'}), (m1:Artifact {id: 'M-1'})
  CREATE (eve)-[:PARTICIPATED {day: 10, messages: 1}]->(m1)
`;

/** One KNOWS score ({score}) for $person and $system. */
export const KNOWS_SCORE = `
  MATCH (:Person {name: $person})-[k:KNOWS]->(:System {name: $system})
  RETURN k.score AS score
`;

/** One COLLAB weight between $a and $b, either direction ({weight}). */
export const COLLAB_WEIGHT = `
  MATCH (:Person {name: $a})-[c:COLLAB]-(:Person {name: $b})
  RETURN c.weight AS weight
`;

/**
 * Workload test graph: Leaver owns open ticket T-7 about Niche. Busy knows Niche
 * better (3.0) but already holds 10 open tickets; Free knows it less (2.0) and holds
 * none. Both are multiplied by Niche's idf; penalised fit: Busy 3/(1+10/5) = 1, Free 2.
 */
export const WORKLOAD_FIXTURE = `
  CREATE (l:Person {name: 'Leaver', active: true}), (b:Person {name: 'Busy', active: true}),
         (f:Person {name: 'Free', active: true}),
         (n:System {name: 'Niche'}),
         (t:Artifact:Ticket {id: 'T-7', title: 'Niche export', day: 1}),
         (l)-[:ASSIGNED {day: 1, status: 'To Do'}]->(t), (t)-[:MENTIONS {weight: 1}]->(n),
         (:Artifact {id: 'X-1', day: 1}), (:Artifact {id: 'X-2', day: 1}),
         (b)-[:KNOWS {score: 3.0, lastDay: 1, evidence: ['B-1']}]->(n),
         (f)-[:KNOWS {score: 2.0, lastDay: 1, evidence: ['F-1']}]->(n)
  WITH b
  UNWIND range(1, 10) AS i
  CREATE (b)-[:ASSIGNED {day: 1, status: 'In Progress'}]->(:Artifact:Ticket {id: 'BUSY-' + toString(i), day: 1})
`;

/** Bo is listed on a day-9 thread with ($wrote) or without a line of his own. */
export const BO_ON_DAY_9_THREAD = `
  MATCH (bo:Person {name: 'Bo'})
  MERGE (t:Artifact:Thread {id: 'slack_day9'})
  SET t.day = 9
  MERGE (bo)-[r:PARTICIPATED]->(t)
  SET r.day = 9, r.messages = 1, r.wrote = $wrote
`;

/** Bo's activity window ({firstDay, lastSeenDay}). */
export const BO_ACTIVITY = "MATCH (p:Person {name: 'Bo'}) RETURN p.firstDay AS firstDay, p.lastSeenDay AS lastSeenDay";

/** Departures: who has a departedDay, and the artifacts announcing it ({person, departedDay, announcedIn}). */
export const DEPARTURES = `
  MATCH (p:Person) WHERE p.departedDay IS NOT NULL
  OPTIONAL MATCH (p)-[:DEPARTURE_ANNOUNCED_IN]->(a:Artifact)
  RETURN p.name AS person, p.departedDay AS departedDay, p.active AS active, collect(a.id) AS announcedIn
  ORDER BY person
`;

/** Every node label and relationship type with its count ({kind, name, count}): a fingerprint of a graph. */
export const GRAPH_FINGERPRINT = `
  MATCH (n) UNWIND labels(n) AS name
  RETURN 'node' AS kind, name, count(*) AS count
  UNION ALL
  MATCH ()-[r]->()
  RETURN 'edge' AS kind, type(r) AS name, count(*) AS count
`;

/**
 * Backup test graph: Leaver knows core system S with 10.0, Other with 2.0 (below
 * 25% of 10, but the top of everyone who remains once Leaver is gone).
 */
export const BACKUP_FIXTURE = `
  CREATE (l:Person {name: 'Leaver', active: true}), (o:Person {name: 'Other', active: true}),
         (s:System {name: 'S', core: true}),
         (l)-[:KNOWS {score: 10.0, lastDay: 1, evidence: ['A-1']}]->(s),
         (o)-[:KNOWS {score: 2.0, lastDay: 1, evidence: ['B-1']}]->(s)
`;

/** Who is ASSIGNED Ticket $ticketId ({person, day, via, status}). */
export const TICKET_ASSIGNEES = `
  MATCH (p:Person)-[a:ASSIGNED]->(:Ticket {id: $ticketId})
  RETURN p.name AS person, a.day AS day, a.via AS via, a.status AS status
  ORDER BY person
`;

/** How many Action nodes exist ({actions}). */
export const ACTION_COUNT = 'MATCH (a:Action) RETURN count(a) AS actions';

/** Ingest test: every RECEIVED / LISTED_ON edge ({person, rel, artifact}), sorted. */
export const SEEN_EDGES = `
  MATCH (p:Person)-[r:RECEIVED|LISTED_ON]->(a:Artifact)
  RETURN p.name AS person, type(r) AS rel, a.id AS artifact, r.day AS day
  ORDER BY artifact, person
`;
