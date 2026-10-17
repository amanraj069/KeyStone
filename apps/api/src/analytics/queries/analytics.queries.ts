// Analytics Cypher: the Keystone spec queries K2-K8 and K10.
// The spec text is kept as written. Every change is marked "CHANGE:" with the reason:
// either FalkorDB behaviour or what our graph actually stores. Nothing here is
// computed in TypeScript that a query could compute.

// ---------------------------------------------------------------- expertise (run on apex)

/**
 * K2. Materialise recency-weighted expertise as KNOWS edges.
 * Authoring counts 3, reviewing 2, ticket ownership 1; exponential decay with a
 * 30-day time constant (exp() passed the Stage 1 capability check, so it is kept).
 * Artifacts with day null (dayUnknown) are skipped by the WHERE.
 * CHANGE: PARTICIPATED (taking part in a multi-person thread or a meeting) counts
 * 0.5 x min(messages, 4) / 4: one line 0.125, four or more lines 0.5. Before,
 * every participant was an author (3.0), so people in many busy channels "knew"
 * every system discussed there and topped every suggestion.
 */
export const K2_MATERIALISE_KNOWS = `
  MATCH (p:Person)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(a:Artifact)-[:MENTIONS]->(s:System)
  WHERE a.day IS NOT NULL AND a.day <= $asOfDay
  WITH p, s,
       sum(CASE type(r)
             WHEN 'AUTHORED' THEN 3.0
             WHEN 'REVIEWED' THEN 2.0
             WHEN 'ASSIGNED' THEN 1.0
             ELSE 0.5 * (CASE WHEN coalesce(r.messages, 1) >= 4 THEN 4 ELSE coalesce(r.messages, 1) END) / 4.0
           END * exp(-($asOfDay - a.day) / 30.0)) AS score,
       max(a.day) AS lastDay,
       collect(a.id)[0..5] AS evidence
  MERGE (p)-[k:KNOWS]->(s)
  SET k.score = score, k.lastDay = lastDay, k.evidence = evidence
`;

/**
 * Who is active on $asOfDay: nobody whose announced departure day has come
 * (departedDay <= $asOfDay). Run first in every expertise refresh, so experts,
 * bus factor and suggested owners never include someone who has left. Their
 * KNOWS edges stay: their past work is what a departure simulation needs.
 */
export const SET_ACTIVE_AS_OF = `
  MATCH (p:Person)
  SET p.active = (p.departedDay IS NULL OR p.departedDay > $asOfDay)
`;

/**
 * Before K2: drop every KNOWS edge. K2 only MERGEs pairs it finds, so without
 * this a refresh "as of" an earlier day would keep pairs that have no evidence yet.
 */
export const DELETE_ALL_KNOWS = 'MATCH ()-[k:KNOWS]->() DELETE k';

/** After K2: drop KNOWS edges whose score fell below $minScore (MIN_KNOWS_SCORE). */
export const DELETE_WEAK_KNOWS = 'MATCH ()-[k:KNOWS]->() WHERE k.score < $minScore DELETE k';

/** Before K8a: drop existing COLLAB edges (the spec says to delete them first). */
export const DELETE_COLLAB = 'MATCH ()-[c:COLLAB]->() DELETE c';

/**
 * K8a. Collaboration projection: people who touched the same artifact, weighted by
 * how many they share. CHANGE: PARTICIPATED counts too, so conversations still
 * connect people after they stopped being AUTHORED. Note: it writes one edge per pair
 * (a -> b with id(a) < id(b)); the projection adds the reverse direction (see
 * ProjectionService) because FalkorDB's betweenness follows edge direction.
 */
export const K8A_MATERIALISE_COLLAB = `
  MATCH (a:Person)-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]-(b:Person)
  WHERE id(a) < id(b)
  WITH a, b, count(x) AS w
  MERGE (a)-[c:COLLAB]->(b)
  SET c.weight = w
`;

/** The last simulation day that has an artifact: the default "as of" day. */
export const LAST_ARTIFACT_DAY = 'MATCH (a:Artifact) WHERE a.day IS NOT NULL RETURN max(a.day) AS day';

/** KNOWS score distribution (n, min, p25, median, p75, p90, max) for choosing minScore. */
export const KNOWS_SCORE_DISTRIBUTION = `
  MATCH ()-[k:KNOWS]->()
  WITH k.score AS score ORDER BY score
  WITH collect(score) AS xs
  RETURN size(xs) AS n, xs[0] AS min, xs[toInteger(size(xs) * 0.25)] AS p25, xs[size(xs) / 2] AS median,
         xs[toInteger(size(xs) * 0.75)] AS p75, xs[toInteger(size(xs) * 0.9)] AS p90, xs[size(xs) - 1] AS max
`;

/**
 * Records when expertise was last refreshed ($refreshedAt, epoch ms) and as of
 * which day, on a small (:Meta {key: 'expertise'}) node. The what-if module
 * compares it with the projection's stamp to know whether apex_proj is stale.
 * No analytics query matches the Meta label.
 */
export const STAMP_EXPERTISE = `
  MERGE (m:Meta {key: 'expertise'})
  SET m.refreshedAt = $refreshedAt, m.asOfDay = $asOfDay
`;

/** When expertise was last refreshed ({refreshedAt}); no row if never. */
export const EXPERTISE_STAMP = "MATCH (m:Meta {key: 'expertise'}) RETURN m.refreshedAt AS refreshedAt";

/** Counts after a refresh ({knows, collab}). */
export const EXPERTISE_COUNTS = `
  OPTIONAL MATCH ()-[k:KNOWS]->() WITH count(k) AS knows
  OPTIONAL MATCH ()-[c:COLLAB]->() RETURN knows, count(c) AS collab
`;

// ---------------------------------------------------------------- experts (apex)

/** K3a. Who knows this system: the 5 strongest active experts, with evidence ids. Unchanged. */
export const K3A_SYSTEM_EXPERTS = `
  MATCH (s:System {name:$system})<-[k:KNOWS]-(p:Person {active:true})
  RETURN p.name AS person, k.score AS score, k.lastDay AS lastActive, k.evidence AS evidence
  ORDER BY score DESC LIMIT 5
`;

/**
 * K3b. Evidence paths for one person and system: their 10 most recent artifacts about it.
 * CHANGE: includes PARTICIPATED (threads and meetings are evidence too).
 */
export const K3B_EVIDENCE_PATH = `
  MATCH path = (p:Person {name:$person})-[:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(a:Artifact)-[:MENTIONS]->(s:System {name:$system})
  RETURN path ORDER BY a.day DESC LIMIT 10
`;

/** Does a system exist? Lets the API answer 404 instead of an empty list. */
export const SYSTEM_EXISTS = 'MATCH (s:System {name:$system}) RETURN s.name AS name';

/** Does a person exist? */
export const PERSON_EXISTS = 'MATCH (p:Person {name:$person}) RETURN p.name AS name, p.dept AS dept, p.active AS active';

// ---------------------------------------------------------------- bus factor (apex_proj or a copy)

/**
 * K4. Bus factor for every system: active experts at or above $minScore.
 * CHANGE: adds `collect(k.evidence) AS evidence` (one evidence list per expert, in
 * the same order as names) so the response can cite sources.
 * CHANGE: core systems only (WHERE s.core = true). Most extracted systems are
 * named once or twice; counting them as "orphaned" buried the real risks.
 * CHANGE: an expert also needs at least $topShare of the system's top score among
 * active people (MIN_EXPERT_SCORE / EXPERT_SHARE_OF_TOP in analytics.constants.ts).
 */
export const K4_BUS_FACTOR = `
  MATCH (s:System)
  WHERE s.core = true
  OPTIONAL MATCH (s)<-[kt:KNOWS]-(:Person {active:true})
  WITH s, max(kt.score) AS top
  OPTIONAL MATCH (s)<-[k:KNOWS]-(p:Person {active:true})
  WHERE k.score >= $minScore AND k.score >= $topShare * top
  WITH s, count(p) AS experts, collect(p.name) AS names, collect(k.evidence) AS evidence
  RETURN s.name AS system, experts, names, evidence
  ORDER BY experts ASC
`;

/**
 * Systems per risk level for the dashboard (same rule as K4: 0 orphaned,
 * 1 critical, 2 watch, 3+ ok), counted in FalkorDB rather than in TypeScript.
 * Core systems only, same expert rule as K4.
 */
export const RISK_LEVEL_COUNTS = `
  MATCH (s:System)
  WHERE s.core = true
  OPTIONAL MATCH (s)<-[kt:KNOWS]-(:Person {active:true})
  WITH s, max(kt.score) AS top
  OPTIONAL MATCH (s)<-[k:KNOWS]-(p:Person {active:true})
  WHERE k.score >= $minScore AND k.score >= $topShare * top
  WITH s, count(p) AS experts
  RETURN sum(CASE WHEN experts = 0 THEN 1 ELSE 0 END) AS orphaned,
         sum(CASE WHEN experts = 1 THEN 1 ELSE 0 END) AS critical,
         sum(CASE WHEN experts = 2 THEN 1 ELSE 0 END) AS watch,
         sum(CASE WHEN experts >= 3 THEN 1 ELSE 0 END) AS ok
`;

// ---------------------------------------------------------------- departure impact (apex)

/**
 * K5. Systems the leaver knows, and how many active backups each has.
 * CHANGE: adds `k.evidence AS evidence` (the leaver's evidence for the system) for citations.
 * CHANGE: core systems only (s.core = true), and the same expert rule as K4 for
 * the leaver and the backups ($minScore and $topShare of the system's top score).
 * CHANGE: a backup is measured against the top score WITHOUT the leaver (topLeft),
 * i.e. the expert rule as it applies once they are gone. Measured against the
 * leaver's own score, a strong leaver hid every backup: K5 said Jax orphans 10
 * systems while the what-if simulation (which recomputes the rule) found 4.
 */
export const K5_DEPARTURE_SYSTEMS = `
  MATCH (leaver:Person {name:$person})-[k:KNOWS]->(s:System)
  WHERE k.score >= $minScore AND s.core = true
  OPTIONAL MATCH (s)<-[kt:KNOWS]-(:Person {active:true})
  WITH leaver, k, s, max(kt.score) AS top
  WHERE k.score >= $topShare * top
  OPTIONAL MATCH (s)<-[kl:KNOWS]-(left:Person {active:true})
  WHERE left <> leaver
  WITH leaver, k, s, max(kl.score) AS topLeft
  OPTIONAL MATCH (s)<-[k2:KNOWS]-(other:Person {active:true})
  WHERE other <> leaver AND k2.score >= $minScore AND k2.score >= $topShare * topLeft
  WITH s, k, count(other) AS backups, collect(other.name) AS backupNames
  RETURN s.name AS system, k.score AS leaverScore, backups, backupNames, k.evidence AS evidence
  ORDER BY backups ASC, leaverScore DESC
`;

/**
 * K6. Open tickets the leaver owns, with up to 3 suggested new owners.
 * CHANGE: our graph stores ticket status on the ASSIGNED edge, not the Ticket
 * node (the spec's coalesce already reads it), and 29 of 173 assignments have no
 * status at all. `NOT null IN [...]` is null, which would silently drop those
 * tickets, so a missing status counts as open ('unknown'), and the comparison is
 * case-insensitive (the data has "To Do"; the test fixture uses "done").
 * Pass $doneStatuses in lower case.
 * CHANGE: owner fit = sum(k.score * s.idf) instead of sum(k.score). idf
 * (log(totalArtifacts / (1 + mentionCount)), set by the expertise refresh) makes a
 * niche system the ticket names count more than one named everywhere, so the
 * same three generalists no longer top every ticket.
 * CHANGE: workload penalty, fit / (1 + openTicketsAssigned / 5): someone already
 * holding 5 open tickets needs twice the fit. Added because, even weighted by idf,
 * three people took 76% of all suggestions (rule: add it above 40%).
 * CHANGE: also returns ownerEvidence, one list of artifact ids per suggested
 * owner (same order), so a suggestion can be cited. A ticket with no candidate
 * gives cand = null; mapping its evidence to null keeps both lists empty.
 */
export const K6_DEPARTURE_TICKETS = `
  MATCH (:Person {name:$person})-[asg:ASSIGNED]->(t:Ticket)
  WHERE NOT toLower(coalesce(t.status, asg.status, 'unknown')) IN $doneStatuses
  OPTIONAL MATCH (t)-[:MENTIONS]->(s:System)<-[k:KNOWS]-(cand:Person {active:true})
  WHERE cand.name <> $person
  WITH t, cand, sum(k.score * s.idf) AS rawFit, collect(k.evidence) AS evidenceLists
  OPTIONAL MATCH (cand)-[held:ASSIGNED]->(busy:Ticket)
  WHERE NOT toLower(coalesce(busy.status, held.status, 'unknown')) IN $doneStatuses
  WITH t, cand, rawFit, evidenceLists, count(busy) AS openTickets
  WITH t, cand, rawFit / (1 + openTickets / 5.0) AS fit, evidenceLists
  WITH t, cand, fit,
       CASE WHEN cand IS NULL THEN NULL
            ELSE reduce(ids = [], e IN evidenceLists | ids + e)[0..3] END AS evidence
  ORDER BY fit DESC
  RETURN t.id AS ticket, t.title AS title, collect(cand.name)[0..3] AS suggestedOwners,
         collect(evidence)[0..3] AS ownerEvidence
`;

/** K7. Pages the leaver wrote that nobody else has authored or reviewed. Unchanged. */
export const K7_DEPARTURE_PAGES = `
  MATCH (p:Person {name:$person})-[:AUTHORED]->(d:Page)
  OPTIONAL MATCH (d)<-[:AUTHORED|REVIEWED]-(o:Person)
  WHERE o <> p
  WITH d, count(o) AS others
  WHERE others = 0
  RETURN d.id AS page, d.title AS title
`;

// ---------------------------------------------------------------- bridges (apex_proj or a copy)

/**
 * K8b. Bridge people: betweenness centrality on the collaboration graph.
 * Run it on apex_proj, where COLLAB exists in both directions: FalkorDB's
 * betweenness follows edge direction (checked: x->y<-z gives y 0; with reverse
 * edges y gets 2), so on apex's one-way COLLAB edges the scores would be skewed.
 * CHANGE: samplingSize 1000 and a fixed samplingSeed. FalkorDB estimates
 * betweenness from randomly sampled start nodes (with replacement, so no setting is
 * exact), and by default the scores changed every time apex_proj was rebuilt (Priya
 * 88, 95, 92, 108). A fixed seed makes the result repeatable; 1000 samples (about
 * 23 per person) keep the ranking stable. Scores scale with samplingSize, so only
 * compare scores computed with the same settings (what-if does).
 */
export const K8B_BRIDGES = `
  CALL algo.betweenness({nodeLabels:['Person'], relationshipTypes:['COLLAB'], samplingSize: 1000, samplingSeed: 7})
  YIELD node, score
  RETURN node.name AS person, score
  ORDER BY score DESC LIMIT 10
`;

/**
 * Evidence for a bridge person (apex): up to 5 artifacts they share with people
 * from other departments, with who those people are. Not in the spec; added so
 * the bridges answer can cite sources.
 */
export const BRIDGE_EVIDENCE = `
  MATCH (p:Person {name:$person})-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]-(o:Person)
  WHERE o.dept IS NOT NULL AND p.dept IS NOT NULL AND o.dept <> p.dept
  WITH p, x, collect(DISTINCT o.dept) AS otherDepts
  ORDER BY x.day DESC
  RETURN p.dept AS dept, collect(x.id)[0..5] AS evidence, collect(otherDepts)[0..5] AS reaches
`;

// ---------------------------------------------------------------- decisions (apex)

/**
 * K10a. Decision trace for a system, newest first.
 * CHANGES:
 *  - The author MATCH is OPTIONAL and authors are collected: every decision source
 *    in our graph has an author (checked: 0 without), but Slack threads and
 *    meetings have several, and the spec's MATCH returned one row per author,
 *    repeating the same decision up to 7 times.
 *  - Columns get explicit names (summary, day, ...) and the decision id is
 *    returned, so the API can map and cite them.
 *  - Authors include PARTICIPATED: a decision made in a meeting or a thread is
 *    attributed to the people who took part (they no longer have AUTHORED).
 */
export const K10A_DECISION_TRACE = `
  MATCH (d:Decision)-[:ABOUT]->(s:System {name:$system})
  MATCH (d)-[:DECIDED_IN]->(src:Artifact)
  OPTIONAL MATCH (src)<-[:AUTHORED|PARTICIPATED]-(who:Person)
  OPTIONAL MATCH (d)-[:SUPERSEDES]->(old:Decision)
  RETURN d.id AS id, d.summary AS summary, d.day AS day, d.kind AS kind, d.status AS status,
         src.id AS source, src.type AS sourceType, collect(DISTINCT who.name) AS authors,
         old.id AS replacedId, old.summary AS replaced
  ORDER BY day DESC
`;

/**
 * K10b. Stale docs: pages that still assert a decision that has been superseded.
 * CHANGE: also returns the decision ids and the artifact the newer decision was
 * made in, so the answer can cite sources.
 */
export const K10B_STALE_DOCS = `
  MATCH (newer:Decision)-[:SUPERSEDES]->(old:Decision)<-[:ASSERTS]-(page:Page)
  OPTIONAL MATCH (newer)-[:DECIDED_IN]->(src:Artifact)
  RETURN page.id AS stalePage, page.title AS pageTitle, old.id AS outdatedId, old.summary AS outdatedClaim,
         newer.id AS currentId, newer.summary AS currentDecision, newer.day AS decidedOn, src.id AS decidedIn
`;

// ---------------------------------------------------------------- dashboard summary (apex)

/** People by active flag ({active, inactive}). */
export const PEOPLE_COUNTS = `
  MATCH (p:Person)
  RETURN sum(CASE WHEN p.active THEN 1 ELSE 0 END) AS active, sum(CASE WHEN p.active THEN 0 ELSE 1 END) AS inactive
`;

/** Number of stale pages (distinct pages from K10b). */
export const STALE_DOCS_COUNT = `
  MATCH (:Decision)-[:SUPERSEDES]->(:Decision)<-[:ASSERTS]-(page:Page)
  RETURN count(DISTINCT page) AS stale
`;

/** Tickets with at least one assignment not in $doneStatuses (same status rule as K6). */
export const OPEN_TICKETS_COUNT = `
  MATCH (:Person)-[asg:ASSIGNED]->(t:Ticket)
  WHERE NOT toLower(coalesce(t.status, asg.status, 'unknown')) IN $doneStatuses
  RETURN count(DISTINCT t) AS open
`;

// ---------------------------------------------------------------- directory (names the agent can use)

/** Core systems, most mentioned first ({name, mentionCount, authorCount}). */
export const LIST_CORE_SYSTEMS = `
  MATCH (s:System)
  WHERE s.core = true
  RETURN s.name AS name, s.mentionCount AS mentionCount, s.authorCount AS authorCount
  ORDER BY mentionCount DESC, name
`;

/** Every system name with its aliases ({name, aliases}), for "did you mean" suggestions. */
export const SYSTEM_NAMES = `
  MATCH (s:System)
  RETURN s.name AS name, coalesce(s.aliases, []) AS aliases
  ORDER BY name
`;

/** People ({name, dept, active, lastSeenDay, departedDay}); $activeOnly limits to active people. */
export const LIST_PEOPLE = `
  MATCH (p:Person)
  WHERE NOT $activeOnly OR p.active = true
  RETURN p.name AS name, p.dept AS dept, p.active AS active, p.lastSeenDay AS lastSeenDay, p.departedDay AS departedDay
  ORDER BY name
`;

/**
 * Systems worth opening on the Decisions screen ({name, core, decisions, changes}):
 * every core system plus any system with a superseded decision, with how many
 * decisions are about it and how many of those replaced an earlier one. Systems
 * with changes come first, because a timeline with a replacement tells a story.
 * (A pattern inside CASE is always true in FalkorDB, so changes are counted with OPTIONAL MATCH.)
 */
export const SYSTEMS_WITH_DECISIONS = `
  MATCH (s:System)<-[:ABOUT]-(d:Decision)
  OPTIONAL MATCH (d)-[r:SUPERSEDES]->(:Decision)
  WITH s, count(DISTINCT d) AS decisions, count(r) AS changes
  WHERE s.core = true OR changes > 0
  RETURN s.name AS name, coalesce(s.core, false) AS core, decisions, changes
  ORDER BY changes DESC, decisions DESC, name
`;
