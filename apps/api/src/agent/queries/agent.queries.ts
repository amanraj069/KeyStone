// Cypher for the agent: only the look-up of what it cited (artifacts, and notes from memory).

/** Title, type and day of the cited artifacts ($ids) ({id, title, type, day}). */
export const CITED_ARTIFACTS = `
  MATCH (a:Artifact)
  WHERE a.id IN $ids
  RETURN a.id AS id, a.title AS title, a.type AS type, a.day AS day
`;

/** Cited notes ($ids), shaped like a citation: the note's text as its title ({id, title, type, day}). */
export const CITED_NOTES = `
  MATCH (n:Note)
  WHERE n.id IN $ids
  RETURN n.id AS id, n.text AS title, 'note' AS type, n.day AS day
`;
