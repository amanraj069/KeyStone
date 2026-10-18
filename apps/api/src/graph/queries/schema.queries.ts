// Indexes for every Keystone graph. SchemaService.ensureSchema() runs them all;
// FalkorDB answers "already indexed" for ones that exist, which is ignored.
// Index DDL takes no values, so there is nothing to parameterise, except the
// vector dimension (see CHUNK_EMBEDDING_VECTOR_INDEX below).

/** Range index on Person.name: every person lookup (who knows X, what if X leaves) starts here. */
export const PERSON_NAME_INDEX = 'CREATE INDEX FOR (p:Person) ON (p.name)';

/** Range index on Artifact.id: citations, ingestion upserts and links all find artifacts by id. */
export const ARTIFACT_ID_INDEX = 'CREATE INDEX FOR (a:Artifact) ON (a.id)';

/**
 * Range index on Artifact.day: every "as of day N" query filters artifacts with
 * `a.day <= $day`, so this index keeps time-travel queries fast. Artifacts with
 * day: null (dayUnknown) are simply not matched by such filters.
 */
export const ARTIFACT_DAY_INDEX = 'CREATE INDEX FOR (a:Artifact) ON (a.day)';

/** Range index on System.name: expertise and bus-factor queries start from a system. */
export const SYSTEM_NAME_INDEX = 'CREATE INDEX FOR (s:System) ON (s.name)';

/** Range index on Decision.id: decision tracing and SUPERSEDES chains look decisions up by id. */
export const DECISION_ID_INDEX = 'CREATE INDEX FOR (d:Decision) ON (d.id)';

/** Range index on Action.id: approving or rejecting a proposed action finds it by id. */
export const ACTION_ID_INDEX = 'CREATE INDEX FOR (x:Action) ON (x.id)';

/** Range indexes for the agent's memory (Stage 16): chats, turns, notes and users are found by id. */
export const SESSION_ID_INDEX = 'CREATE INDEX FOR (s:Session) ON (s.id)';
export const TURN_ID_INDEX = 'CREATE INDEX FOR (t:Turn) ON (t.id)';
export const NOTE_ID_INDEX = 'CREATE INDEX FOR (n:Note) ON (n.id)';
export const USER_ID_INDEX = 'CREATE INDEX FOR (u:User) ON (u.id)';

/**
 * Vector index on Chunk.embedding for semantic search (cosine similarity).
 * `{{EMBED_DIM}}` is replaced by chunkEmbeddingVectorIndex() below.
 */
export const CHUNK_EMBEDDING_VECTOR_INDEX =
  "CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {dimension: {{EMBED_DIM}}, similarityFunction: 'cosine'}";

/**
 * The vector index statement for a given embedding size.
 *
 * This is the ONLY place in the codebase where a value is interpolated into
 * Cypher: FalkorDB does not accept a query parameter inside index OPTIONS. It
 * is safe because `embedDim` is EMBED_DIM from config, already validated by Zod
 * as an integer in 1..4096, and checked again here before use.
 */
export function chunkEmbeddingVectorIndex(embedDim: number): string {
  if (!Number.isInteger(embedDim) || embedDim < 1 || embedDim > 4096) {
    throw new Error(`EMBED_DIM must be an integer between 1 and 4096, got ${embedDim}`);
  }
  return CHUNK_EMBEDDING_VECTOR_INDEX.replace('{{EMBED_DIM}}', String(embedDim));
}

/** All schema statements, in the order ensureSchema() runs them. */
export function schemaStatements(embedDim: number): string[] {
  return [
    PERSON_NAME_INDEX,
    ARTIFACT_ID_INDEX,
    ARTIFACT_DAY_INDEX,
    SYSTEM_NAME_INDEX,
    DECISION_ID_INDEX,
    ACTION_ID_INDEX,
    SESSION_ID_INDEX,
    TURN_ID_INDEX,
    NOTE_ID_INDEX,
    USER_ID_INDEX,
    chunkEmbeddingVectorIndex(embedDim),
  ];
}

/**
 * Lists every index in the current graph: one row per label with its indexed
 * properties and their index types (RANGE, VECTOR, ...). Used to verify the schema.
 */
export const LIST_INDEXES = 'CALL db.indexes() YIELD label, properties, types RETURN label, properties, types';
