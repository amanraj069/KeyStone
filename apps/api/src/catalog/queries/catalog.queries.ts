// Cypher for the System catalog: usage statistics, the core flag, specificity
// (idf) and merging duplicate System nodes.

// ---------------------------------------------------------------- statistics (written onto System)

/**
 * s.mentionCount = artifacts that MENTION the system; s.authorCount = different
 * people who wrote one of them (AUTHORED, or PARTICIPATED in a thread or meeting).
 * Systems only named by a decision get 0.
 */
export const SET_SYSTEM_STATS = `
  MATCH (s:System)
  OPTIONAL MATCH (a:Artifact)-[:MENTIONS]->(s)
  WITH s, count(DISTINCT a) AS mentions
  OPTIONAL MATCH (p:Person)-[:AUTHORED|PARTICIPATED]->(:Artifact)-[:MENTIONS]->(s)
  WITH s, mentions, count(DISTINCT p) AS authors
  SET s.mentionCount = mentions, s.authorCount = authors
`;

/** s.core: mentioned often enough by enough different people ($minMentions, $minAuthors). */
export const MARK_CORE_SYSTEMS = `
  MATCH (s:System)
  SET s.core = (s.mentionCount >= $minMentions AND s.authorCount >= $minAuthors)
`;

/**
 * s.idf = log(totalArtifacts / (1 + mentionCount)): how specific a system is.
 * A system named in a handful of artifacts (a niche service) weighs more than one
 * named everywhere ("Telemetry"), as in TF-IDF. Natural log.
 */
export const SET_SYSTEM_IDF = `
  MATCH (a:Artifact)
  WITH count(a) AS total
  MATCH (s:System)
  SET s.idf = log(toFloat(total) / (1 + s.mentionCount))
`;

/** How many systems would be core at a given threshold ({core}), to choose CORE_MIN_MENTIONS. */
export const CORE_COUNT_AT = `
  MATCH (s:System)
  WHERE s.mentionCount >= $minMentions AND s.authorCount >= $minAuthors
  RETURN count(s) AS core
`;

/** Systems per mention-count bucket ({bucket, systems}), in bucket order. */
export const MENTION_BUCKETS = `
  MATCH (s:System)
  WITH s.mentionCount AS n
  WITH CASE WHEN n = 0 THEN 0 WHEN n = 1 THEN 1 WHEN n = 2 THEN 2 WHEN n <= 4 THEN 3 WHEN n <= 9 THEN 4 ELSE 5 END AS rank
  RETURN rank, ['0', '1', '2', '3-4', '5-9', '10+'][rank] AS bucket, count(*) AS systems
  ORDER BY rank
`;

/** Systems per distinct-author bucket ({bucket, systems}), in bucket order. */
export const AUTHOR_BUCKETS = `
  MATCH (s:System)
  WITH s.authorCount AS n
  WITH CASE WHEN n = 0 THEN 0 WHEN n = 1 THEN 1 WHEN n = 2 THEN 2 WHEN n <= 4 THEN 3 WHEN n <= 9 THEN 4 ELSE 5 END AS rank
  RETURN rank, ['0', '1', '2', '3-4', '5-9', '10+'][rank] AS bucket, count(*) AS systems
  ORDER BY rank
`;

/** The $limit most mentioned systems ({name, mentionCount, authorCount, core, aliases}). */
export const TOP_SYSTEMS = `
  MATCH (s:System)
  RETURN s.name AS name, s.mentionCount AS mentionCount, s.authorCount AS authorCount,
         s.core AS core, coalesce(s.aliases, []) AS aliases
  ORDER BY mentionCount DESC, name
  LIMIT $limit
`;

/** Every system with its counts ({name, mentionCount, authorCount}), for planning merges. */
export const ALL_SYSTEM_COUNTS = `
  MATCH (s:System)
  RETURN s.name AS name, s.mentionCount AS mentionCount, s.authorCount AS authorCount
  ORDER BY name
`;

/** Totals ({systems, core}). */
export const SYSTEM_TOTALS = `
  MATCH (s:System)
  RETURN count(s) AS systems, sum(CASE WHEN s.core THEN 1 ELSE 0 END) AS core
`;

// ---------------------------------------------------------------- merging duplicates ({keep, dup} rows)
// Run in this order: aliases, MENTIONS, ABOUT, then delete. KNOWS edges go with the
// deleted node and are recomputed by the next expertise refresh (K2), which gives the
// exact score from the moved MENTIONS rather than an approximate sum.

/** The survivor's aliases gain the merged name and its aliases (no duplicates, never its own name). */
export const MERGE_SYSTEM_ALIASES = `
  UNWIND $rows AS row
  MATCH (keep:System {name: row.keep}), (dup:System {name: row.dup})
  SET keep.aliases = reduce(acc = [], x IN coalesce(keep.aliases, []) + [dup.name] + coalesce(dup.aliases, []) |
                            CASE WHEN x IN acc OR x = keep.name THEN acc ELSE acc + x END)
`;

/** Moves MENTIONS to the survivor; if the artifact already mentions it, the higher weight stays. */
export const MOVE_SYSTEM_MENTIONS = `
  UNWIND $rows AS row
  MATCH (dup:System {name: row.dup})<-[m:MENTIONS]-(a:Artifact)
  MATCH (keep:System {name: row.keep})
  MERGE (a)-[n:MENTIONS]->(keep)
  ON CREATE SET n.weight = m.weight
  ON MATCH SET n.weight = CASE WHEN m.weight > n.weight THEN m.weight ELSE n.weight END
  DELETE m
`;

/** Moves ABOUT (decision -> system) to the survivor. */
export const MOVE_SYSTEM_ABOUT = `
  UNWIND $rows AS row
  MATCH (dup:System {name: row.dup})<-[r:ABOUT]-(d:Decision)
  MATCH (keep:System {name: row.keep})
  MERGE (d)-[:ABOUT]->(keep)
  DELETE r
`;

/** Deletes the merged System nodes (and their KNOWS edges). */
export const DELETE_MERGED_SYSTEMS = `
  UNWIND $rows AS row
  MATCH (dup:System {name: row.dup})
  DETACH DELETE dup
`;
