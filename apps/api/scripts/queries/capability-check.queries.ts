// Cypher used only by scripts/capability-check.ts.
// Each query proves FalkorDB supports one feature Keystone depends on.

/** Creates one Person per name in $names. Returns nothing. */
export const CREATE_PEOPLE = 'UNWIND $names AS name CREATE (:Person {name: name})';

/** Creates a KNOWS edge for each {from, to} in $edges. Returns nothing. */
export const CREATE_KNOWS_EDGES = `
  UNWIND $edges AS edge
  MATCH (a:Person {name: edge.from}), (b:Person {name: edge.to})
  CREATE (a)-[:KNOWS]->(b)
`;

/** Returns { nodes, edges } so we can confirm the fixture was written. */
export const COUNT_NODES_AND_EDGES = `
  MATCH (n) WITH count(n) AS nodes
  OPTIONAL MATCH ()-[r]->() RETURN nodes, count(r) AS edges
`;

/** Betweenness centrality per person. Keystone uses it to find knowledge bottlenecks. */
export const BETWEENNESS = 'CALL algo.betweenness({}) YIELD node, score RETURN node.name AS name, score';

/** Weakly connected component id per person. Keystone uses it to spot isolated groups. */
export const WCC = 'CALL algo.WCC({}) YIELD node, componentId RETURN node.name AS name, componentId';

/** PageRank per person over KNOWS edges. Keystone uses it to rank influence. */
export const PAGE_RANK =
  "CALL algo.pageRank('Person', 'KNOWS') YIELD node, score RETURN node.name AS name, score";

/** Returns e (2.718...). Proves math functions used by decay scores exist. */
export const EXP_ONE = 'RETURN exp(1) AS e';

/**
 * Creates a 4-dimension cosine vector index on Person.embedding.
 * Index options are fixed by us (not user input), so they are written inline.
 */
export const CREATE_VECTOR_INDEX = `
  CREATE VECTOR INDEX FOR (p:Person) ON (p.embedding)
  OPTIONS {dimension: 4, similarityFunction: 'cosine'}
`;

/** Stores a vector on each person from $vectors = [{name, embedding}]. */
export const SET_EMBEDDINGS = `
  UNWIND $vectors AS v
  MATCH (p:Person {name: v.name})
  SET p.embedding = vecf32(v.embedding)
`;

/** Returns the $k people whose embedding is closest to $query, nearest first. */
export const VECTOR_NEAREST = `
  CALL db.idx.vector.queryNodes('Person', 'embedding', $k, vecf32($query))
  YIELD node, score
  RETURN node.name AS name, score
`;

/** Returns { people } in a graph; used to check the copy has the same data. */
export const COUNT_PEOPLE = 'MATCH (p:Person) RETURN count(p) AS people';
