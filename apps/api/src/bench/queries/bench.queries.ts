// Cypher for the benchmark (Stage 13). Read-only lookups on apex that decide how a
// gold answer is scored. Departure prediction and bus factor reuse the analytics
// queries (K4, K5) on projections built by ProjectionService.

/**
 * Which of $values are artifact ids ({id}). A gold answer made only of artifact
 * ids is scored by exact match against the ids an answer cites.
 */
export const KNOWN_ARTIFACT_IDS = `
  UNWIND $values AS value
  MATCH (a:Artifact {id: value})
  RETURN DISTINCT a.id AS id
`;

/**
 * Which of $values are a person's name or a system's name ({name}). Such a gold
 * answer is scored by a normalised string match instead of the LLM judge.
 */
export const KNOWN_PERSON_OR_SYSTEM_NAMES = `
  UNWIND $values AS value
  OPTIONAL MATCH (p:Person {name: value})
  OPTIONAL MATCH (s:System {name: value})
  WITH value, p, s
  WHERE p IS NOT NULL OR s IS NOT NULL
  RETURN DISTINCT value AS name
`;

/**
 * B1's second predictor ({system, score, share}): systems where $person held at least
 * $minShare of everyone's knowledge as of $asOfDay, with a score of at least
 * $minScore. Same per-activity weights and 30-day decay as K2 / KNOWS_AS_OF
 * (projection.queries.ts) so thread participation counts, but over every system
 * named in at least $minMentions documents (not only core ones), and measured as a
 * share of the system's total instead of against its top expert. Biggest share first.
 */
export const KNOWLEDGE_SHARE_AS_OF = `
  MATCH (p:Person)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(a:Artifact)-[:MENTIONS]->(s:System)
  WHERE a.day IS NOT NULL AND a.day <= $asOfDay AND coalesce(s.mentionCount, 0) >= $minMentions
    AND coalesce(p.firstDay, 0) <= $asOfDay AND (p.departedDay IS NULL OR p.departedDay > $asOfDay)
  WITH p, s,
       sum(CASE type(r)
             WHEN 'AUTHORED' THEN 3.0
             WHEN 'REVIEWED' THEN 2.0
             WHEN 'ASSIGNED' THEN 1.0
             ELSE 0.5 * (CASE WHEN coalesce(r.messages, 1) >= 4 THEN 4 ELSE coalesce(r.messages, 1) END) / 4.0
           END * exp(-($asOfDay - a.day) / 30.0)) AS score
  WITH s, sum(score) AS total, collect({name: p.name, score: score}) AS scores
  UNWIND scores AS x
  WITH s, total, x
  WHERE x.name = $person AND total > 0 AND x.score >= $minScore AND x.score / total >= $minShare
  RETURN s.name AS system, x.score AS score, x.score / total AS share
  ORDER BY share DESC, score DESC
  LIMIT $limit
`;
