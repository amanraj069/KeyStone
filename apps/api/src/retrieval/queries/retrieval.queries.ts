// Cypher for retrieval (Stage 6). Chunks hold only ids and an embedding; their
// text lives in the TextStore (AGENTS.md section 3). Writes use batchWrite.

/** Removes all chunks before a rebuild, so re-indexing never duplicates them. */
export const DELETE_CHUNKS = 'MATCH (c:Chunk) DETACH DELETE c';

/**
 * One Chunk per row, linked to its artifact ({id, artifactId, model, vector}).
 * `model` records which embedding model made the vector, so a query embedded
 * with a different model can be refused instead of returning nonsense.
 */
export const CREATE_CHUNKS = `
  UNWIND $rows AS row
  MATCH (a:Artifact {id: row.artifactId})
  CREATE (c:Chunk {id: row.id, artifactId: row.artifactId, model: row.model, embedding: vecf32(row.vector)})
  CREATE (c)-[:PART_OF]->(a)
`;

/** Artifacts with their title and type, in id order: the input for chunking. */
export const ARTIFACTS_TO_CHUNK = `
  MATCH (a:Artifact)
  RETURN a.id AS id, coalesce(a.title, '') AS title
  ORDER BY id
`;

/** The vector index on Chunk.embedding, with its options (dimension, similarity). */
export const CHUNK_VECTOR_INDEX = `
  CALL db.indexes() YIELD label, properties, types, options
  WITH label, properties, types, options WHERE label = 'Chunk'
  RETURN properties, types, options
`;

/** Which embedding model the stored chunks were made with ({model, chunks}). */
export const CHUNK_MODELS = 'MATCH (c:Chunk) RETURN c.model AS model, count(c) AS chunks';

/**
 * Hybrid search (spec K11, adapted). The vector index finds the k nearest
 * chunks; the graph then adds what the words alone cannot: the artifact the
 * chunk belongs to, artifacts linked to it within 2 REFERENCES hops, and who
 * wrote it. Notes:
 *   - FalkorDB returns `score` as a DISTANCE (0 = identical), so nearest first is ASC.
 *   - Vector queries cannot take property filters, so the "as of day" filter
 *     ($asOfDay, null = no filter) is applied after the CALL.
 *   - `linked <> a` stops an artifact from listing itself through a 2-hop loop.
 */
export const HYBRID_SEARCH = `
  CALL db.idx.vector.queryNodes('Chunk', 'embedding', $k, vecf32($q)) YIELD node, score
  MATCH (node)-[:PART_OF]->(a:Artifact)
  WHERE $asOfDay IS NULL OR a.day <= $asOfDay
  OPTIONAL MATCH (a)-[:REFERENCES*1..2]-(linked:Artifact)
  WHERE linked <> a
  OPTIONAL MATCH (a)<-[:AUTHORED]-(author:Person)
  RETURN node.id AS chunkId, a.id AS id, a.title AS title, a.type AS type, a.day AS day, score,
         collect(DISTINCT linked.id)[0..8] AS related, collect(DISTINCT author.name) AS authors
  ORDER BY score ASC
`;

/**
 * Vector-only baseline for benchmarks: the same index, embedding and k, but no
 * graph expansion and no filters. Returns chunk ids, artifact ids and distance.
 */
export const VECTOR_ONLY_SEARCH = `
  CALL db.idx.vector.queryNodes('Chunk', 'embedding', $k, vecf32($q)) YIELD node, score
  RETURN node.id AS chunkId, node.artifactId AS id, score
  ORDER BY score ASC
`;
