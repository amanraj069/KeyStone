// Cypher for live documents: company documents posted while Keystone runs. They go
// through the same ingest and extraction as artifacts.jsonl, are marked live: true,
// and can all be removed again (POST /live/reset), leaving the graph as it was.

/** Marks a just-ingested artifact as live, so it can be listed and removed. */
export const MARK_LIVE = 'MATCH (a:Artifact {id: $id}) SET a.live = true, a.postedAt = $at';

/** The live documents, newest first ({id, title, type, day, authors}). */
export const LIVE_ARTIFACTS = `
  MATCH (a:Artifact {live: true})
  OPTIONAL MATCH (p:Person)-[:AUTHORED|PARTICIPATED]->(a)
  WITH a, collect(DISTINCT p.name) AS authors
  RETURN a.id AS id, a.title AS title, a.type AS type, a.day AS day, authors, a.postedAt AS postedAt
  ORDER BY postedAt DESC
`;

/**
 * Reset, step 1: people whose departure a live document announced get their
 * departedDay back (null, or the earliest day a corpus document announces) ({person}).
 */
export const UNDO_LIVE_DEPARTURES = `
  MATCH (p:Person)-[:DEPARTURE_ANNOUNCED_IN]->(:Artifact {live: true})
  WITH DISTINCT p
  OPTIONAL MATCH (p)-[d:DEPARTURE_ANNOUNCED_IN]->(other:Artifact)
  WHERE other.live IS NULL
  WITH p, min(d.departedDay) AS corpusDay
  SET p.departedDay = corpusDay
  RETURN p.name AS person
`;

/** Reset, step 2: every live document with its chunks and the decisions made in it ({deleted}). */
export const DELETE_LIVE = `
  MATCH (a:Artifact {live: true})
  OPTIONAL MATCH (c:Chunk)-[:PART_OF]->(a)
  OPTIONAL MATCH (d:Decision)-[:DECIDED_IN]->(a)
  WITH collect(DISTINCT a) + collect(DISTINCT c) + collect(DISTINCT d) AS doomed
  UNWIND doomed AS x
  DETACH DELETE x
  RETURN count(x) AS deleted
`;

/** Reset, step 3: decisions that only deleted live decisions had replaced are active again ({reactivated}). */
export const REACTIVATE_DECISIONS = `
  MATCH (d:Decision {status: 'superseded'})
  WHERE NOT ()-[:SUPERSEDES]->(d)
  SET d.status = 'active'
  RETURN count(d) AS reactivated
`;
