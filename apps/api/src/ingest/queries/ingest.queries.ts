// Cypher for deterministic ingestion (no LLM). Every write uses
// GraphService.batchWrite, so each query starts with UNWIND $rows AS row and
// reads its values from `row`. MERGE makes every query safe to run twice:
// re-ingesting or replaying the same day never duplicates nodes or edges.

/** Creates the departments ({name}). */
export const MERGE_DEPTS = `
  UNWIND $rows AS row
  MERGE (:Dept {name: row.name})
`;

/**
 * Creates people ({name, dept}) and their MEMBER_OF edge. People with no known
 * department get no MEMBER_OF edge. firstDay/lastSeenDay are set later by
 * UPDATE_PERSON_ACTIVITY from their edges.
 */
export const MERGE_PEOPLE = `
  UNWIND $rows AS row
  MERGE (p:Person {name: row.name})
  SET p.dept = row.dept, p.active = true
  WITH p, row WHERE row.dept IS NOT NULL
  MATCH (d:Dept {name: row.dept})
  MERGE (p)-[:MEMBER_OF]->(d)
`;

// One query per artifact label: labels cannot be query parameters, and string-
// building Cypher is not allowed, so each label has its own constant.
// Rows: {id, type, title, day, dayUnknown, isIncident, bodyLength}.

/** Ticket artifacts (jira, zd_ticket). */
export const MERGE_TICKET_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Ticket {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Page artifacts (confluence). */
export const MERGE_PAGE_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Page {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Thread artifacts (slack). */
export const MERGE_THREAD_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Thread {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** PR artifacts (pr). */
export const MERGE_PR_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:PR {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Email artifacts (email). */
export const MERGE_EMAIL_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Email {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Meeting artifacts (zoom_transcript), a key source of decisions in Stage 5. */
export const MERGE_MEETING_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Meeting {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Alert artifacts (datadog_alert). */
export const MERGE_ALERT_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Alert {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Record artifacts (invoice, sf_opp, nps_survey). */
export const MERGE_RECORD_ARTIFACTS = `
  UNWIND $rows AS row
  MERGE (a:Artifact:Record {id: row.id})
  SET a.type = row.type, a.title = row.title, a.day = row.day, a.dayUnknown = row.dayUnknown,
      a.isIncident = row.isIncident, a.bodyLength = row.bodyLength
`;

/** Person wrote the artifact ({person, artifactId, day}). */
export const MERGE_AUTHORED = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (a:Artifact {id: row.artifactId})
  MERGE (p)-[r:AUTHORED]->(a)
  SET r.day = row.day
`;

/** Person reviewed the artifact, e.g. a PR ({person, artifactId, day}). */
export const MERGE_REVIEWED = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (a:Artifact {id: row.artifactId})
  MERGE (p)-[r:REVIEWED]->(a)
  SET r.day = row.day
`;

/**
 * Person took part in a conversation (multi-person Slack thread, meeting, Salesforce
 * opportunity) and wrote `messages` messages in it; `wrote` is false when they are only
 * listed ({person, artifactId, day, messages, wrote}).
 */
export const MERGE_PARTICIPATED = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (a:Artifact {id: row.artifactId})
  MERGE (p)-[r:PARTICIPATED]->(a)
  SET r.day = row.day, r.messages = row.messages, r.wrote = row.wrote
`;

/**
 * Removes every Person -> Artifact role edge, so roles can be rewritten from
 * artifacts.jsonl without resetting the graph (extraction and chunks stay).
 */
export const DELETE_ROLE_EDGES = `
  MATCH (:Person)-[r:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(:Artifact)
  DELETE r
`;

/**
 * A person announced as leaving in an artifact ({person, artifactId, departedDay}).
 * The edge keeps the evidence; Person.departedDay is the earliest announced day.
 */
export const MERGE_DEPARTURES = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (a:Artifact {id: row.artifactId})
  MERGE (p)-[d:DEPARTURE_ANNOUNCED_IN]->(a)
  SET d.departedDay = row.departedDay,
      p.departedDay = CASE WHEN p.departedDay IS NULL OR row.departedDay < p.departedDay
                           THEN row.departedDay ELSE p.departedDay END
`;

/** Before rewriting departures: remove the evidence edges... */
export const DELETE_DEPARTURE_EDGES = 'MATCH (:Person)-[d:DEPARTURE_ANNOUNCED_IN]->(:Artifact) DELETE d';

/** ...and the departure days. */
export const CLEAR_DEPARTED_DAYS = 'MATCH (p:Person) WHERE p.departedDay IS NOT NULL SET p.departedDay = NULL';

/** Person owns / was assigned the ticket ({person, artifactId, day, status}). */
export const MERGE_ASSIGNED = `
  UNWIND $rows AS row
  MATCH (p:Person {name: row.person}), (a:Artifact {id: row.artifactId})
  MERGE (p)-[r:ASSIGNED]->(a)
  SET r.day = row.day, r.status = row.status
`;

/**
 * Artifact links from the dataset ({from, to, kind}). Both ends must already
 * exist; a link to a later artifact is created when that artifact loads.
 */
export const MERGE_REFERENCES = `
  UNWIND $rows AS row
  MATCH (a:Artifact {id: row.from}), (b:Artifact {id: row.to})
  MERGE (a)-[:REFERENCES {kind: row.kind}]->(b)
`;

/** A PR whose title starts with "[TICKET-ID]" fixes that ticket ({pr, ticket}). */
export const MERGE_FIXES = `
  UNWIND $rows AS row
  MATCH (pr:Artifact:PR {id: row.pr}), (t:Artifact:Ticket {id: row.ticket})
  MERGE (pr)-[:FIXES]->(t)
`;

/**
 * Sets each person's firstDay and lastSeenDay from the days of their
 * AUTHORED/REVIEWED/ASSIGNED edges and PARTICIPATED edges where the person wrote
 * a line (being listed on a thread or meeting is not activity). A person is active
 * unless a departure was announced for them (departedDay, see MERGE_DEPARTURES);
 * the expertise refresh then sets active as of its day.
 */
export const UPDATE_PERSON_ACTIVITY = `
  MATCH (p:Person)
  OPTIONAL MATCH (p)-[r:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(a:Artifact)
  WHERE type(r) <> 'PARTICIPATED' OR r.wrote = true
  WITH p, min(a.day) AS firstDay, max(a.day) AS lastSeenDay
  SET p.firstDay = firstDay, p.lastSeenDay = lastSeenDay, p.active = true
`;

/** Returns {people, artifacts, edges}: graph totals shown in the progress stream. */
export const GRAPH_COUNTS = `
  OPTIONAL MATCH (p:Person)
  WITH count(p) AS people
  OPTIONAL MATCH (a:Artifact)
  WITH people, count(a) AS artifacts
  OPTIONAL MATCH ()-[r]->()
  RETURN people, artifacts, count(r) AS edges
`;
