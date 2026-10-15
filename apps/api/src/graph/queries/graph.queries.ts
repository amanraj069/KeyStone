// Cypher used by the graph module itself (connection checks, not domain logic).
// Every query is a constant here so the README can list it and tests can run it.

/**
 * Returns one row: { ok: 1 }.
 * Why: GET /health runs it to prove FalkorDB is not just accepting TCP
 * connections but actually executing Cypher.
 */
export const HEALTH_PING = 'RETURN 1 AS ok';
