// Cypher for reading artifacts: one artifact for the UI, and the agent's event tools
// (find_artifacts, get_artifact, what_followed) that look artifacts up by day, people and links.

/**
 * One artifact by id ({id, label, type, title, day, bodyLength, people}): label is
 * its specific label (Ticket, Page, ...), people everyone who wrote, reviewed, owns
 * or took part in it. The body itself is in the TextStore, not the graph.
 */
export const ARTIFACT_DETAIL = `
  MATCH (a:Artifact {id: $id})
  OPTIONAL MATCH (p:Person)-[:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(a)
  RETURN a.id AS id, [l IN labels(a) WHERE l <> 'Artifact'][0] AS label, a.type AS type, a.title AS title,
         a.day AS day, a.bodyLength AS bodyLength, collect(DISTINCT p.name) AS people
`;

// ---------------------------------------------------------------- event tools (find_artifacts, get_artifact, what_followed)

/**
 * Artifacts matching every given filter ({id, type, title, day, matched, people}).
 * Null / empty filters are ignored: $fromDay..$toDay (inclusive day range), $types
 * (doc types such as 'jira'), $title (lower-case substring of the title) and $people
 * (at least one of them wrote, reviewed, owns, took part in, received or is listed on
 * it). `matched` is how
 * many of $people are involved, so artifacts involving more of them come first, then
 * by day. people lists everyone involved with their role, at most 12.
 */
export const FIND_ARTIFACTS = `
  MATCH (a:Artifact)
  WHERE ($fromDay IS NULL OR a.day >= $fromDay) AND ($toDay IS NULL OR a.day <= $toDay)
    AND (size($types) = 0 OR a.type IN $types)
    AND ($title IS NULL OR toLower(a.title) CONTAINS $title)
  OPTIONAL MATCH (p:Person)-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(a)
  WHERE p.name IN $people
  WITH a, count(DISTINCT p) AS matched
  WHERE size($people) = 0 OR matched > 0
  OPTIONAL MATCH (q:Person)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(a)
  WITH a, matched, [x IN collect(DISTINCT {name: q.name, role: toLower(type(r))}) WHERE x.name IS NOT NULL] AS people
  RETURN a.id AS id, a.type AS type, a.title AS title, a.day AS day, matched, people[0..12] AS people
  ORDER BY matched DESC, day ASC, id ASC
  LIMIT $limit
`;

/**
 * Everyone involved in one artifact, with every role they had ({name, roles, day}):
 * roles are 'authored', 'reviewed', 'assigned', 'participated', 'received' (an
 * email's recipient) or 'listed_on' (named on it); day is the earliest day of their
 * involvement. Answers "was this person part of it?".
 */
export const ARTIFACT_PEOPLE = `
  MATCH (p:Person)-[r:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED|RECEIVED|LISTED_ON]->(:Artifact {id: $id})
  RETURN p.name AS name, collect(DISTINCT toLower(type(r))) AS roles, min(r.day) AS day
  ORDER BY name
`;

/**
 * Artifacts directly linked to one artifact, in either direction ({id, type,
 * title, day, link, kind, direction}): link is REFERENCES or FIXES, kind the
 * REFERENCES kind, direction 'out' (this artifact points at it) or 'in'.
 * Oldest first, at most $limit.
 */
export const ARTIFACT_LINKS = `
  MATCH (a:Artifact {id: $id})-[l:REFERENCES|FIXES]-(b:Artifact)
  RETURN DISTINCT b.id AS id, b.type AS type, b.title AS title, b.day AS day, type(l) AS link, l.kind AS kind,
         CASE WHEN startNode(l) = a THEN 'out' ELSE 'in' END AS direction
  ORDER BY day ASC, id ASC
  LIMIT $limit
`;

/**
 * What followed one artifact ({id, type, title, day, linked, shared}): artifacts
 * dated from its day to $days later (optionally only $types) that are linked to it
 * (REFERENCES / FIXES, up to two hops) or involve someone who was involved in it.
 * linked says whether a link exists; shared names the people in common. Linked
 * ones first, then by people in common, then by day. Answers "was anything done
 * in response to X?"; an empty result means nothing in the records followed it.
 */
export const WHAT_FOLLOWED = `
  MATCH (src:Artifact {id: $id})
  OPTIONAL MATCH (src)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED]-(sp:Person)
  WITH src, collect(DISTINCT sp.name) AS srcPeople
  MATCH (b:Artifact)
  WHERE b <> src AND b.day >= src.day AND b.day <= src.day + $days AND (size($types) = 0 OR b.type IN $types)
  OPTIONAL MATCH path = (src)-[:REFERENCES|FIXES*1..2]-(b)
  WITH src, srcPeople, b, count(path) > 0 AS linked
  OPTIONAL MATCH (b)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED]-(bp:Person)
  WHERE bp.name IN srcPeople
  WITH b, linked, collect(DISTINCT bp.name) AS shared
  WHERE linked OR size(shared) > 0
  RETURN b.id AS id, b.type AS type, b.title AS title, b.day AS day, linked, shared
  ORDER BY linked DESC, size(shared) DESC, day ASC, id ASC
  LIMIT $limit
`;

// ---------------------------------------------------------------- finding an event, and verdicts the graph decides

/**
 * Candidates for an event described by day and people ({id, type, title, day,
 * matched, people}): every artifact from $fromDay to $toDay (optionally only $types),
 * with how many of $people are involved in it in any way. Unlike FIND_ARTIFACTS it
 * keeps artifacts none of them touched (an external sender, say), because the caller
 * also scores the title and text. At most $limit, most people first, then by day.
 */
export const FIND_EVENT_CANDIDATES = `
  MATCH (a:Artifact)
  WHERE a.day >= $fromDay AND a.day <= $toDay AND (size($types) = 0 OR a.type IN $types)
  OPTIONAL MATCH (p:Person)-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(a)
  WHERE p.name IN $people
  WITH a, count(DISTINCT p) AS matched
  OPTIONAL MATCH (q:Person)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(a)
  WITH a, matched, [x IN collect(DISTINCT {name: q.name, role: toLower(type(r))}) WHERE x.name IS NOT NULL] AS people
  RETURN a.id AS id, a.type AS type, a.title AS title, a.day AS day, matched, people[0..12] AS people
  ORDER BY matched DESC, day ASC, id ASC
  LIMIT $limit
`;

/**
 * Did a response of a given kind follow an artifact? ({id, type, title, day, hops}):
 * artifacts linked to $id (REFERENCES / FIXES, up to two hops, either direction),
 * dated from its day to $days later, of $types (all when empty) and, when $title is
 * set, with that word in the title. Linked only: an artifact that merely shares
 * people may be unrelated, so it does not count as a response. Empty = none followed.
 */
export const CHECK_FOLLOW_UP = `
  MATCH (src:Artifact {id: $id})
  MATCH path = (src)-[:REFERENCES|FIXES*1..2]-(b:Artifact)
  WHERE b <> src AND b.day >= src.day AND b.day <= src.day + $days
    AND (size($types) = 0 OR b.type IN $types)
    AND ($title IS NULL OR toLower(b.title) CONTAINS $title)
  WITH b, min(length(path)) AS hops
  RETURN b.id AS id, b.type AS type, b.title AS title, b.day AS day, hops
  ORDER BY day ASC, hops ASC, id ASC
  LIMIT 10
`;

/**
 * Was a person involved in each of $ids by $asOfDay (null = any day)? ({id, title,
 * day, roles, viaLinked}): roles are their direct edges to the artifact (including
 * received and listed_on); viaLinked lists artifacts linked to it (REFERENCES /
 * FIXES, one hop) that the person was directly involved in, by the same day.
 */
export const CHECK_INVOLVEMENT = `
  MATCH (p:Person {name: $person})
  UNWIND $ids AS id
  MATCH (a:Artifact {id: id})
  OPTIONAL MATCH (p)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(a)
  WHERE $asOfDay IS NULL OR a.day <= $asOfDay
  WITH p, a, collect(DISTINCT toLower(type(r))) AS roles
  OPTIONAL MATCH (a)-[:REFERENCES|FIXES]-(b:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]-(p)
  WHERE $asOfDay IS NULL OR b.day <= $asOfDay
  RETURN a.id AS id, a.title AS title, a.day AS day, roles, collect(DISTINCT b.id)[0..5] AS viaLinked
  ORDER BY day ASC, id ASC
`;

/**
 * Is a later artifact linked to an earlier one? ({cause, effect, via, kinds}): for
 * each pair from $causes x $effects, the shortest chain of REFERENCES / FIXES links
 * (up to three, either direction) between them, as artifact ids and link kinds.
 * No row for a pair = no recorded link between them.
 */
export const CHECK_CAUSAL_LINK = `
  MATCH (c:Artifact), (e:Artifact)
  WHERE c.id IN $causes AND e.id IN $effects AND c <> e
  MATCH path = (c)-[:REFERENCES|FIXES*1..3]-(e)
  WITH c, e, path ORDER BY length(path) ASC
  WITH c, e, collect(path)[0] AS p
  RETURN c.id AS cause, e.id AS effect, [n IN nodes(p) | n.id] AS via, [r IN relationships(p) | coalesce(r.kind, type(r))] AS kinds
  ORDER BY cause, effect
`;

/** Which of $ids are artifacts ({id}): a tool only returns ids that exist as evidence. */
export const EXISTING_ARTIFACT_IDS = `
  UNWIND $ids AS id
  MATCH (a:Artifact {id: id})
  RETURN DISTINCT a.id AS id
`;

/**
 * When two events are not linked: did the later one come soon after, among the same
 * people? ({cause, effect, daysApart, shared}): pairs from $causes x $effects where the
 * effect is dated 0..$days after the cause and at least one person is involved in both
 * (any role, received or listed). Closest first. Weaker than a link, but a recorded
 * follow-on by the same people shortly after is the usual sign that one led to the other.
 */
export const CAUSAL_PROXIMITY = `
  MATCH (c:Artifact), (e:Artifact)
  WHERE c.id IN $causes AND e.id IN $effects AND c <> e AND e.day >= c.day AND e.day <= c.day + $days
  MATCH (c)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]-(p:Person)-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED|RECEIVED|LISTED_ON]->(e)
  WITH c, e, collect(DISTINCT p.name) AS shared
  RETURN c.id AS cause, e.id AS effect, e.day - c.day AS daysApart, shared
  ORDER BY daysApart ASC, cause, effect
`;
