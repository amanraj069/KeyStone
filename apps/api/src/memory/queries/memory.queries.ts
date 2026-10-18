// Cypher for the agent's memory: what was asked (Session, Turn), what users said about
// the answers (Feedback, Note) and who asked (User). Memory lives in the company graph
// itself, so a turn links to the artifacts it cited and the systems and people it was
// about, and a recall is a traversal from those nodes.
//
// Only approved notes ever reach the agent: a correction is a proposal until a person
// approves it, the same rule as Actions.

/**
 * recordTurn, step 1: one answered question as a Turn of its Session ({id, n}).
 * The User and Session are created on first use; the Turn is numbered within the
 * session (n = 1, 2, ...) and linked to the previous one with NEXT.
 */
export const CREATE_TURN = `
  MERGE (u:User {id: $userId})
    ON CREATE SET u.firstAt = $at
  MERGE (s:Session {id: $sessionId})
    ON CREATE SET s.startedAt = $at, s.title = $title, s.turns = 0
  MERGE (u)-[:STARTED]->(s)
  SET s.lastAt = $at, s.turns = s.turns + 1
  CREATE (t:Turn {id: $id, n: s.turns, question: $question, summary: $summary, label: $label, outcome: $outcome,
                  tools: $tools, at: $at, day: $day, latencyMs: $latencyMs}),
         (s)-[:HAS_TURN]->(t)
  WITH s, t
  OPTIONAL MATCH (s)-[:HAS_TURN]->(prev:Turn)
  WHERE prev.n = t.n - 1
  FOREACH (x IN CASE WHEN prev IS NULL THEN [] ELSE [prev] END | CREATE (x)-[:NEXT]->(t))
  RETURN t.id AS id, t.n AS n
`;

/** recordTurn, step 2: the artifacts a turn cited ($ids; unknown ids are skipped). */
export const LINK_TURN_CITED = `
  MATCH (t:Turn {id: $turnId})
  UNWIND $ids AS cid
  MATCH (a:Artifact {id: cid})
  MERGE (t)-[:CITED]->(a)
`;

/** recordTurn, step 3: the systems a turn was about ($names: from tool arguments and the question). */
export const LINK_TURN_SYSTEMS = `
  MATCH (t:Turn {id: $turnId})
  UNWIND $names AS name
  MATCH (s:System {name: name})
  MERGE (t)-[:CONCERNS]->(s)
`;

/** recordTurn, step 4: the people a turn was about. */
export const LINK_TURN_PEOPLE = `
  MATCH (t:Turn {id: $turnId})
  UNWIND $names AS name
  MATCH (p:Person {name: name})
  MERGE (t)-[:CONCERNS]->(p)
`;

/**
 * The last $limit turns of a session, oldest first, with the artifacts each cited
 * and the systems and people it was about ({id, n, question, summary, cited, subjects}).
 * They become the conversation the model sees before a follow-up question.
 */
export const PRIOR_TURNS = `
  MATCH (:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
  WITH t ORDER BY t.n DESC LIMIT $limit
  OPTIONAL MATCH (t)-[:CITED]->(a:Artifact)
  WITH t, collect(DISTINCT a.id) AS cited
  OPTIONAL MATCH (t)-[:CONCERNS]->(x)
  RETURN t.id AS id, t.n AS n, t.question AS question, t.summary AS summary, cited, collect(DISTINCT x.name) AS subjects
  ORDER BY n
`;

/**
 * Core systems named in a text ({name}): $terms are the text's lower-cased words and
 * runs of up to four words, so "Who owns titan db?" finds TitanDB through its alias.
 */
export const SYSTEMS_IN_TERMS = `
  MATCH (s:System)
  WHERE s.core = true
    AND (toLower(s.name) IN $terms OR any(alias IN coalesce(s.aliases, []) WHERE toLower(alias) IN $terms))
  RETURN s.name AS name
`;

/** People named in a text ({name}), from the same $terms. */
export const PEOPLE_IN_TERMS = `
  MATCH (p:Person)
  WHERE toLower(p.name) IN $terms
  RETURN p.name AS name
`;

/**
 * Approved notes about any of $names (systems or people), newest first ({id, text, day}).
 * These are added to the question so the agent can use and cite them.
 */
export const APPROVED_NOTES_ABOUT = `
  MATCH (n:Note {status: 'approved'})-[:CONCERNS]->(x)
  WHERE x.name IN $names AND (x:System OR x:Person)
  WITH DISTINCT n
  RETURN n.id AS id, n.text AS text, n.day AS day
  ORDER BY n.createdAt DESC LIMIT $limit
`;

/**
 * What Keystone remembers about each of $names: approved notes, how often it was
 * asked about, and the latest questions ({subject, kind, timesAsked, notes, pastQuestions}).
 * Shared company memory: questions from every user count.
 */
export const RECALL = `
  UNWIND $names AS name
  OPTIONAL MATCH (s:System {name: name})
  OPTIONAL MATCH (p:Person {name: name})
  WITH name, s, coalesce(s, p) AS x
  WHERE x IS NOT NULL
  OPTIONAL MATCH (n:Note {status: 'approved'})-[:CONCERNS]->(x)
  WITH s, x, collect(DISTINCT CASE WHEN n IS NULL THEN NULL ELSE {id: n.id, text: n.text, day: n.day} END) AS notes
  OPTIONAL MATCH (t:Turn)-[:CONCERNS]->(x)
  WITH s, x, notes, t ORDER BY t.at DESC
  WITH s, x, notes, count(t) AS timesAsked,
       collect(CASE WHEN t IS NULL THEN NULL ELSE {question: t.question, summary: t.summary, at: t.at} END) AS turns
  RETURN x.name AS subject, CASE WHEN s IS NULL THEN 'person' ELSE 'system' END AS kind, timesAsked, notes,
         turns[0..$maxQuestions] AS pastQuestions
`;

/** Does a turn exist? ({id}) Feedback on an unknown turn is a 404. */
export const TURN_EXISTS = 'MATCH (t:Turn {id: $turnId}) RETURN t.id AS id';

/** A thumbs-up or thumbs-down on a turn ({turnId}). The turn keeps the latest rating. */
export const RECORD_FEEDBACK = `
  MATCH (t:Turn {id: $turnId})
  MERGE (u:User {id: $userId})
    ON CREATE SET u.firstAt = $at
  CREATE (f:Feedback {id: $id, rating: $rating, at: $at}), (f)-[:ON]->(t), (u)-[:GAVE]->(f)
  SET t.rating = $rating
  RETURN t.id AS turnId
`;

/**
 * A correction as a proposed Note ({id}): it CORRECTS the turn, is about the same
 * systems and people, and is BASED_ON the artifacts the turn cited. Names found in
 * the correction text itself are linked by LINK_NOTE_SYSTEMS / LINK_NOTE_PEOPLE.
 */
export const PROPOSE_NOTE = `
  MATCH (t:Turn {id: $turnId})
  MERGE (u:User {id: $userId})
    ON CREATE SET u.firstAt = $at
  CREATE (n:Note {id: $id, text: $text, kind: 'correction', status: 'proposed', day: t.day, createdAt: $at}),
         (n)-[:CORRECTS]->(t), (u)-[:WROTE]->(n)
  WITH n, t
  OPTIONAL MATCH (t)-[:CONCERNS]->(x)
  WITH n, t, collect(x) AS subjects
  FOREACH (y IN subjects | MERGE (n)-[:CONCERNS]->(y))
  WITH n, t
  OPTIONAL MATCH (t)-[:CITED]->(a:Artifact)
  WITH n, collect(a) AS cited
  FOREACH (y IN cited | MERGE (n)-[:BASED_ON]->(y))
  RETURN n.id AS id
`;

/** Systems named in a note's own text ($names). */
export const LINK_NOTE_SYSTEMS = `
  MATCH (n:Note {id: $noteId})
  UNWIND $names AS name
  MATCH (s:System {name: name})
  MERGE (n)-[:CONCERNS]->(s)
`;

/** People named in a note's own text ($names). */
export const LINK_NOTE_PEOPLE = `
  MATCH (n:Note {id: $noteId})
  UNWIND $names AS name
  MATCH (p:Person {name: name})
  MERGE (n)-[:CONCERNS]->(p)
`;

/**
 * Notes for the Audit page, newest first, optionally one $status (null = all)
 * ({id, text, status, day, createdAt, reviewedAt, reason, subjects, question, turnId, evidence}).
 */
export const LIST_NOTES = `
  MATCH (n:Note)
  WHERE $status IS NULL OR n.status = $status
  OPTIONAL MATCH (n)-[:CORRECTS]->(t:Turn)
  OPTIONAL MATCH (n)-[:CONCERNS]->(x)
  OPTIONAL MATCH (n)-[:BASED_ON]->(a:Artifact)
  RETURN n.id AS id, n.text AS text, n.status AS status, n.day AS day, n.createdAt AS createdAt,
         n.reviewedAt AS reviewedAt, n.reason AS reason, collect(DISTINCT x.name) AS subjects,
         t.question AS question, t.id AS turnId, collect(DISTINCT a.id) AS evidence
  ORDER BY createdAt DESC LIMIT $limit
`;

/** One note's status ({id, status}); no row when it does not exist. */
export const NOTE_STATUS = 'MATCH (n:Note {id: $id}) RETURN n.id AS id, n.status AS status';

/** Approve or reject a proposed note ($status, $reason); no row when it was not proposed ({id}). */
export const REVIEW_NOTE = `
  MATCH (n:Note {id: $id})
  WHERE n.status = 'proposed'
  SET n.status = $status, n.reviewedAt = $at, n.reason = $reason
  RETURN n.id AS id
`;

/** A user's chats, most recent first ({id, title, startedAt, lastAt, turns}). */
export const SESSIONS_OF_USER = `
  MATCH (:User {id: $userId})-[:STARTED]->(s:Session)
  RETURN s.id AS id, s.title AS title, s.startedAt AS startedAt, s.lastAt AS lastAt, s.turns AS turns
  ORDER BY lastAt DESC LIMIT $limit
`;
