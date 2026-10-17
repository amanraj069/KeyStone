// Cypher for the agent: only the look-up of what it cited.

/** Title, type and day of the cited artifacts ($ids) ({id, title, type, day}). */
export const CITED_ARTIFACTS = `
  MATCH (a:Artifact)
  WHERE a.id IN $ids
  RETURN a.id AS id, a.title AS title, a.type AS type, a.day AS day
`;
