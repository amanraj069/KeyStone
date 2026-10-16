// Cypher for LLM extraction (systems, decisions, supersedes, asserts).
// Writes go through GraphService.batchWrite (UNWIND $rows AS row) and use MERGE
// on stable ids, so re-running extraction never duplicates nodes or edges.

/**
 * Candidate artifacts for extraction: id, extra label, title, day, authors and
 * the authors' departments (people who AUTHORED it or PARTICIPATED in it: the same
 * people who were all AUTHORED before the participation model, so cached
 * extraction fingerprints still match). $depts = [] means "all departments".
 * Bodies are NOT here: they are read from the TextStore.
 */
export const SELECT_CANDIDATES = `
  MATCH (a:Artifact)
  WHERE a:Page OR a:Thread OR a:PR OR a:Email OR a:Ticket OR a:Meeting
  OPTIONAL MATCH (p:Person)-[:AUTHORED|PARTICIPATED]->(a)
  OPTIONAL MATCH (p)-[:MEMBER_OF]->(d:Dept)
  WITH a, collect(DISTINCT p.name) AS authors, collect(DISTINCT d.name) AS depts
  WHERE size($depts) = 0 OR any(dept IN depts WHERE dept IN $depts)
  RETURN a.id AS id, [l IN labels(a) WHERE l <> 'Artifact'][0] AS label, a.title AS title, a.day AS day, authors
  ORDER BY id
`;

/** Every artifact id (the vocabulary reads all bodies, not only the selected ones). */
export const ALL_ARTIFACT_IDS = 'MATCH (a:Artifact) RETURN a.id AS id';

/** Titles of all Page artifacts (a source of system names for the vocabulary). */
export const PAGE_TITLES = 'MATCH (a:Page) RETURN a.title AS title';

/** Removes everything a previous extraction wrote, so a rerun rebuilds it cleanly from the cache. */
export const CLEAR_EXTRACTION = `
  MATCH (n) WHERE n:System OR n:Decision OR n:Claim
  DETACH DELETE n
`;

/** Systems with their canonical name and the raw spellings that mapped to it ({name, aliases}). */
export const MERGE_SYSTEMS = `
  UNWIND $rows AS row
  MERGE (s:System {name: row.name})
  SET s.aliases = row.aliases
`;

/** Artifact talks about a system, weighted by relevance ({artifactId, system, weight}). */
export const MERGE_MENTIONS = `
  UNWIND $rows AS row
  MATCH (a:Artifact {id: row.artifactId}), (s:System {name: row.system})
  MERGE (a)-[m:MENTIONS]->(s)
  SET m.weight = row.weight
`;

/**
 * A decision and the artifact it was decided in ({id, artifactId, summary, day, kind, confidence}).
 * Every decision starts active; the second pass marks superseded ones.
 */
export const MERGE_DECISIONS = `
  UNWIND $rows AS row
  MATCH (a:Artifact {id: row.artifactId})
  MERGE (d:Decision {id: row.id})
  SET d.summary = row.summary, d.day = row.day, d.kind = row.kind,
      d.confidence = row.confidence, d.status = 'active'
  MERGE (d)-[:DECIDED_IN]->(a)
`;

/** Decision is about a system ({decisionId, system}). */
export const MERGE_ABOUT = `
  UNWIND $rows AS row
  MATCH (d:Decision {id: row.decisionId}), (s:System {name: row.system})
  MERGE (d)-[:ABOUT]->(s)
`;

/** Temporary: a claim made by a page, kept until the second pass ({id, pageId, claim, system}). */
export const MERGE_CLAIMS = `
  UNWIND $rows AS row
  MATCH (p:Page {id: row.pageId})
  MERGE (c:Claim {id: row.id})
  SET c.claim = row.claim, c.system = row.system
  MERGE (p)-[:CLAIMS]->(c)
`;

/**
 * Input for the second pass: per system, its decisions in date order and the
 * page claims about it (ordered by page and claim id, so the same graph always
 * gives the same prompt, and therefore a cache hit). Only systems with at least one decision and two or
 * more decisions + claims in total are worth an LLM call.
 */
export const SYSTEMS_FOR_LINKING = `
  MATCH (s:System)
  OPTIONAL MATCH (d:Decision)-[:ABOUT]->(s)
  WITH s, d ORDER BY coalesce(d.day, 1000000), d.id
  WITH s, collect(CASE WHEN d IS NULL THEN NULL ELSE {id: d.id, day: d.day, summary: d.summary} END) AS decisions
  OPTIONAL MATCH (p:Page)-[:CLAIMS]->(c:Claim {system: s.name})
  WITH s, decisions, p, c ORDER BY p.id, c.id
  WITH s, decisions, collect(CASE WHEN c IS NULL THEN NULL ELSE {pageId: p.id, claim: c.claim} END) AS claims
  WHERE size(decisions) >= 1 AND size(decisions) + size(claims) >= 2
  RETURN s.name AS system, decisions, claims
  ORDER BY system
`;

/** Newer decision replaces older ({newerId, olderId}); the older one becomes superseded. */
export const MERGE_SUPERSEDES = `
  UNWIND $rows AS row
  MATCH (newer:Decision {id: row.newerId}), (older:Decision {id: row.olderId})
  MERGE (newer)-[r:SUPERSEDES]->(older)
  SET r.day = newer.day, older.status = 'superseded'
`;

/** A page states a decision ({pageId, decisionId}); stale if that decision is superseded. */
export const MERGE_ASSERTS = `
  UNWIND $rows AS row
  MATCH (p:Page {id: row.pageId}), (d:Decision {id: row.decisionId})
  MERGE (p)-[:ASSERTS]->(d)
`;

/** Claims were only needed for the second pass. */
export const DELETE_CLAIMS = 'MATCH (c:Claim) DETACH DELETE c';

/** The 20 systems mentioned by the most artifacts ({system, mentions}). */
export const TOP_SYSTEMS_BY_MENTIONS = `
  MATCH (:Artifact)-[m:MENTIONS]->(s:System)
  RETURN s.name AS system, count(m) AS mentions
  ORDER BY mentions DESC, system
  LIMIT 20
`;

/** Totals for stats-extraction.md. */
export const EXTRACTION_COUNTS = `
  OPTIONAL MATCH (s:System) WITH count(s) AS systems
  OPTIONAL MATCH (d:Decision) WITH systems, count(d) AS decisions,
    sum(CASE WHEN d.status = 'superseded' THEN 1 ELSE 0 END) AS superseded
  OPTIONAL MATCH ()-[m:MENTIONS]->() WITH systems, decisions, superseded, count(m) AS mentions
  OPTIONAL MATCH ()-[x:SUPERSEDES]->() WITH systems, decisions, superseded, mentions, count(x) AS supersedes
  OPTIONAL MATCH ()-[y:ASSERTS]->() WITH systems, decisions, superseded, mentions, supersedes, count(y) AS asserts
  OPTIONAL MATCH (z:Claim)
  RETURN systems, decisions, superseded, mentions, supersedes, asserts, count(z) AS claims
`;

/** Decisions per kind ({kind, n}). */
export const DECISIONS_BY_KIND = 'MATCH (d:Decision) RETURN d.kind AS kind, count(d) AS n ORDER BY n DESC';

/** Decisions that ended up with no ABOUT edge (no system named). */
export const DECISIONS_WITHOUT_SYSTEM = 'MATCH (d:Decision) WHERE NOT (d)-[:ABOUT]->() RETURN count(d) AS n';

/** Pages that assert a superseded decision: stale documentation ({page, decision}). */
export const STALE_PAGES = `
  MATCH (p:Page)-[:ASSERTS]->(d:Decision {status: 'superseded'})
  RETURN p.id AS page, p.title AS title, d.id AS decision, d.summary AS summary
  ORDER BY page LIMIT 20
`;

// ---------------------------------------------------------------- replay: copy one day's extraction from apex
// The replay graph is built without LLM calls, so it has no systems or decisions of its own.
// After each replayed day these read what extraction already wrote into apex for that
// day's artifacts; the MERGE_* queries above write it into the replay graph.

/** Systems mentioned by artifacts of $day, and decisions made that day ({name, aliases}). */
export const REPLAY_SYSTEMS_FOR_DAY = `
  MATCH (a:Artifact {day: $day})-[:MENTIONS]->(s:System)
  RETURN DISTINCT s.name AS name, s.aliases AS aliases
  UNION
  MATCH (:Artifact {day: $day})<-[:DECIDED_IN]-(:Decision)-[:ABOUT]->(s:System)
  RETURN DISTINCT s.name AS name, s.aliases AS aliases
`;

/** MENTIONS edges of artifacts of $day ({artifactId, system, weight}). */
export const REPLAY_MENTIONS_FOR_DAY = `
  MATCH (a:Artifact {day: $day})-[m:MENTIONS]->(s:System)
  RETURN a.id AS artifactId, s.name AS system, m.weight AS weight
  ORDER BY artifactId, system
`;

/** Decisions made in artifacts of $day ({id, artifactId, summary, day, kind, confidence}). */
export const REPLAY_DECISIONS_FOR_DAY = `
  MATCH (d:Decision)-[:DECIDED_IN]->(a:Artifact {day: $day})
  RETURN d.id AS id, a.id AS artifactId, d.summary AS summary, d.day AS day, d.kind AS kind, d.confidence AS confidence
  ORDER BY id
`;

/** ABOUT edges of those decisions ({decisionId, system}). */
export const REPLAY_ABOUT_FOR_DAY = `
  MATCH (:Artifact {day: $day})<-[:DECIDED_IN]-(d:Decision)-[:ABOUT]->(s:System)
  RETURN d.id AS decisionId, s.name AS system
  ORDER BY decisionId, system
`;

/** SUPERSEDES whose newer decision was made on $day; the older one is already replayed ({newerId, olderId}). */
export const REPLAY_SUPERSEDES_FOR_DAY = `
  MATCH (:Artifact {day: $day})<-[:DECIDED_IN]-(newer:Decision)-[:SUPERSEDES]->(older:Decision)
  RETURN newer.id AS newerId, older.id AS olderId
`;

/**
 * ASSERTS where the page or the decision's source is from $day: whichever of
 * the two arrives later creates the edge ({pageId, decisionId}).
 */
export const REPLAY_ASSERTS_FOR_DAY = `
  MATCH (p:Page)-[:ASSERTS]->(d:Decision)-[:DECIDED_IN]->(src:Artifact)
  WHERE p.day = $day OR src.day = $day
  RETURN p.id AS pageId, d.id AS decisionId
`;

// ---------------------------------------------------------------- targeted stale-page pass

/**
 * Core systems worth a targeted stale-page pass: at least one superseded decision
 * or 3+ decisions ({system, decisions, superseded, claims}). Claims must have been
 * rebuilt first (they only exist during a linking run).
 */
export const STALE_LINK_TARGETS = `
  MATCH (s:System)
  WHERE s.core = true
  OPTIONAL MATCH (d:Decision)-[:ABOUT]->(s)
  WITH s, count(d) AS decisions, sum(CASE WHEN d.status = 'superseded' THEN 1 ELSE 0 END) AS superseded
  WHERE superseded >= 1 OR decisions >= 3
  OPTIONAL MATCH (:Page)-[:CLAIMS]->(c:Claim {system: s.name})
  RETURN s.name AS system, decisions, superseded, count(c) AS claims
  ORDER BY system
`;

/**
 * Prompt input for the systems in $names: decisions oldest first, and page claims
 * with the day the page was written ({system, decisions, claims}).
 */
export const STALE_LINK_INPUT = `
  MATCH (s:System)
  WHERE s.name IN $names
  OPTIONAL MATCH (d:Decision)-[:ABOUT]->(s)
  WITH s, d ORDER BY coalesce(d.day, 1000000), d.id
  WITH s, collect(CASE WHEN d IS NULL THEN NULL ELSE {id: d.id, day: d.day, summary: d.summary} END) AS decisions
  OPTIONAL MATCH (p:Page)-[:CLAIMS]->(c:Claim {system: s.name})
  WITH s, decisions, p, c ORDER BY p.id, c.id
  WITH s, decisions, collect(CASE WHEN c IS NULL THEN NULL ELSE {pageId: p.id, pageDay: p.day, claim: c.claim} END) AS claims
  RETURN s.name AS system, decisions, claims
  ORDER BY system
`;

/** SUPERSEDES between two decisions made in the same artifact: a document does not supersede itself. */
export const DELETE_SAME_SOURCE_SUPERSEDES = `
  MATCH (n:Decision)-[r:SUPERSEDES]->(o:Decision)
  MATCH (n)-[:DECIDED_IN]->(src:Artifact)<-[:DECIDED_IN]-(o)
  DELETE r
`;

/** A decision marked superseded that no SUPERSEDES edge points at any more is active again. */
export const REACTIVATE_UNSUPERSEDED = `
  MATCH (o:Decision {status: 'superseded'})
  WHERE NOT ()-[:SUPERSEDES]->(o)
  SET o.status = 'active'
`;
