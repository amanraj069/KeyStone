// Cypher for the people-and-systems projection (apex_proj): Person, System,
// KNOWS and COLLAB only. What-if and the benchmark copy this small graph
// instead of apex (AGENTS.md section 3).

// ---------------------------------------------------------------- read from apex (roQuery)
// Every read is paged (ORDER BY + SKIP $skip LIMIT $limit): FalkorDB returns at most
// RESULTSET_SIZE rows (10,000 by default) and apex already has 11,656 KNOWS edges.

/** Active people now ({name, dept, active}). */
export const ACTIVE_PEOPLE = `
  MATCH (p:Person {active: true})
  RETURN p.name AS name, p.dept AS dept, p.active AS active
  ORDER BY name SKIP $skip LIMIT $limit
`;

/**
 * People active on $asOfDay ({name, dept, active}): already started (firstDay)
 * and not yet left (lastDay null, or on/after that day).
 */
export const ACTIVE_PEOPLE_AS_OF = `
  MATCH (p:Person)
  WHERE coalesce(p.firstDay, 0) <= $asOfDay AND (p.lastDay IS NULL OR p.lastDay >= $asOfDay)
  RETURN p.name AS name, p.dept AS dept, true AS active
  ORDER BY name SKIP $skip LIMIT $limit
`;

/**
 * Core systems ({name}); core systems with no expert stay in, they are the orphaned
 * ones. Non-core systems stay in apex only (retrieval and citations).
 */
export const CORE_SYSTEMS = `
  MATCH (s:System)
  WHERE s.core = true
  RETURN s.name AS name
  ORDER BY name SKIP $skip LIMIT $limit
`;

/** Materialised KNOWS edges of active people to core systems ({person, system, score, lastDay, evidence}). */
export const ACTIVE_KNOWS = `
  MATCH (p:Person {active: true})-[k:KNOWS]->(s:System)
  WHERE s.core = true
  RETURN p.name AS person, s.name AS system, k.score AS score, k.lastDay AS lastDay, k.evidence AS evidence
  ORDER BY person, system SKIP $skip LIMIT $limit
`;

/**
 * KNOWS as of $asOfDay without writing anything: K2's aggregation as a
 * read-only RETURN, for people active on that day, dropping scores below $minScore.
 */
export const KNOWS_AS_OF = `
  MATCH (p:Person)-[r:AUTHORED|ASSIGNED|REVIEWED]->(a:Artifact)-[:MENTIONS]->(s:System)
  WHERE a.day IS NOT NULL AND a.day <= $asOfDay
    AND coalesce(p.firstDay, 0) <= $asOfDay AND (p.lastDay IS NULL OR p.lastDay >= $asOfDay)
  WITH p, s,
       sum(CASE type(r) WHEN 'AUTHORED' THEN 3.0 WHEN 'REVIEWED' THEN 2.0 ELSE 1.0 END
           * exp(-($asOfDay - a.day) / 30.0)) AS score,
       max(a.day) AS lastDay,
       collect(a.id)[0..5] AS evidence
  WHERE score >= $minScore
  RETURN p.name AS person, s.name AS system, score, lastDay, evidence
  ORDER BY person, system SKIP $skip LIMIT $limit
`;

/** The $percentile weight of COLLAB edges between active people ({weight}); null if none. */
export const ACTIVE_COLLAB_WEIGHT_PERCENTILE = `
  MATCH (a:Person {active: true})-[c:COLLAB]->(b:Person {active: true})
  RETURN percentileDisc(c.weight, $percentile) AS weight
`;

/** Materialised COLLAB edges between active people with weight >= $minWeight ({a, b, weight}). */
export const ACTIVE_COLLAB = `
  MATCH (a:Person {active: true})-[c:COLLAB]->(b:Person {active: true})
  WHERE c.weight >= $minWeight
  RETURN a.name AS a, b.name AS b, c.weight AS weight
  ORDER BY a, b SKIP $skip LIMIT $limit
`;

/** The $percentile weight of COLLAB as of $asOfDay (same aggregation as COLLAB_AS_OF) ({weight}). */
export const COLLAB_AS_OF_WEIGHT_PERCENTILE = `
  MATCH (a:Person)-[:AUTHORED|ASSIGNED|REVIEWED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED]-(b:Person)
  WHERE id(a) < id(b) AND x.day IS NOT NULL AND x.day <= $asOfDay
    AND coalesce(a.firstDay, 0) <= $asOfDay AND (a.lastDay IS NULL OR a.lastDay >= $asOfDay)
    AND coalesce(b.firstDay, 0) <= $asOfDay AND (b.lastDay IS NULL OR b.lastDay >= $asOfDay)
  WITH a, b, count(x) AS w
  RETURN percentileDisc(w, $percentile) AS weight
`;

/** COLLAB as of $asOfDay without writing: K8a's aggregation, artifacts up to that day, weight >= $minWeight. */
export const COLLAB_AS_OF = `
  MATCH (a:Person)-[:AUTHORED|ASSIGNED|REVIEWED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED]-(b:Person)
  WHERE id(a) < id(b) AND x.day IS NOT NULL AND x.day <= $asOfDay
    AND coalesce(a.firstDay, 0) <= $asOfDay AND (a.lastDay IS NULL OR a.lastDay >= $asOfDay)
    AND coalesce(b.firstDay, 0) <= $asOfDay AND (b.lastDay IS NULL OR b.lastDay >= $asOfDay)
  WITH a, b, count(x) AS w
  WHERE w >= $minWeight
  RETURN a.name AS a, b.name AS b, w AS weight
  ORDER BY a, b SKIP $skip LIMIT $limit
`;

// ---------------------------------------------------------------- write the target graph (batchWrite)

/** People ({name, dept, active}). */
export const WRITE_PEOPLE = `
  UNWIND $rows AS row
  CREATE (:Person {name: row.name, dept: row.dept, active: row.active})
`;

/** Core systems ({name}); core is stored so K4's WHERE s.core = true works on the projection too. */
export const WRITE_SYSTEMS = `
  UNWIND $rows AS row
  CREATE (:System {name: row.name, core: true})
`;

/** KNOWS edges ({person, system, score, lastDay, evidence}). */
export const WRITE_KNOWS = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (s:System {name: row.system})
  CREATE (p)-[:KNOWS {score: row.score, lastDay: row.lastDay, evidence: row.evidence}]->(s)
`;

/**
 * COLLAB edges ({a, b, weight}), written in BOTH directions: collaboration is
 * mutual, and FalkorDB's betweenness follows edge direction (with one-way edges
 * a person between two others can score 0).
 */
export const WRITE_COLLAB = `
  UNWIND $rows AS row
  MATCH (a:Person {name: row.a}), (b:Person {name: row.b})
  CREATE (a)-[:COLLAB {weight: row.weight}]->(b), (b)-[:COLLAB {weight: row.weight}]->(a)
`;

/** Counts in the projection ({people, systems, knows, collab}). */
export const PROJECTION_COUNTS = `
  OPTIONAL MATCH (p:Person) WITH count(p) AS people
  OPTIONAL MATCH (s:System) WITH people, count(s) AS systems
  OPTIONAL MATCH ()-[k:KNOWS]->() WITH people, systems, count(k) AS knows
  OPTIONAL MATCH ()-[c:COLLAB]->() RETURN people, systems, knows, count(c) AS collab
`;
