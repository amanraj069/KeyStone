# Keystone graph queries (K1-K11)

Keystone answers questions about a company from one FalkorDB knowledge graph.
These eleven queries are the core of it: they build the expertise model, find
knowledge risks, trace decisions and power search. All aggregation and graph
algorithms run inside FalkorDB; the API only passes parameters and maps rows.

Each query below has its purpose, the graph it runs on, and its current Cypher.
Where the code differs from the original design, every change is listed with a
one-line reason. The code lives in `apps/api/src/**/queries/*.ts` (each change
is marked `CHANGE:` there) and is tested against the fixture graph in
`apps/api/test/fixtures/mini-company.cypher`.

**Graphs.** `apex` is the whole company: people, artifacts (tickets, pages,
threads, PRs, emails, meetings), systems and decisions. `apex_proj` is a small
projection of it (active people, core systems, KNOWS and COLLAB) used by graph
algorithms and what-if copies.

**People and artifacts.** `AUTHORED` is real authorship (page, PR, email,
ticket creator, the single writer of a thread). People in a multi-person thread
or a meeting have `PARTICIPATED {messages}` instead, `REVIEWED` is a PR review,
and `ASSIGNED {status}` is ticket ownership.

**Active people.** A person is active on a day unless a departure announced in the
company's documents (`departedDay`) has come; every expertise refresh sets `active` as of
its day, so the `{active:true}` patterns below never match someone who has left. Their
past work (artifacts, KNOWS) stays in the graph.

**Core systems.** A system is core when at least 5 artifacts mention it, written
by at least 2 people. Risk queries (K4, K5, the projection) use core systems only;
all systems stay in `apex` for search and citations.

**Experts.** A person is an expert on a core system when their KNOWS score is at
least 0.4 (the median KNOWS score on core systems) and at least 25% of the
system's top score.

---

## K1. Schema and indexes

Purpose: make every lookup that starts a query (a person, an artifact, a day, a
system, a decision) an index lookup, and enable vector search on chunks.
Graph: every Keystone graph (`apex`, `apex_proj`, replays, test graphs).

```cypher
CREATE INDEX FOR (p:Person) ON (p.name)
CREATE INDEX FOR (a:Artifact) ON (a.id)
CREATE INDEX FOR (a:Artifact) ON (a.day)
CREATE INDEX FOR (s:System) ON (s.name)
CREATE INDEX FOR (d:Decision) ON (d.id)
CREATE INDEX FOR (x:Action) ON (x.id)
CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding) OPTIONS {dimension: 768, similarityFunction: 'cosine'}
```

## K2. Recency-weighted expertise (KNOWS)

Purpose: score how well each person knows each system, from what they wrote,
reviewed, owned or discussed about it, with older work counting less.
Graph: `apex` (and replay graphs, after each replayed day).

```cypher
// Before: count how many systems each artifact mentions (SET_MENTIONED_SYSTEMS)
MATCH (a:Artifact)-[:MENTIONS]->(s:System)
WITH a, count(s) AS n
SET a.mentionedSystems = n

MATCH (p:Person)-[r:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(a:Artifact)-[m:MENTIONS]->(s:System)
WHERE a.day IS NOT NULL AND a.day <= $asOfDay
WITH p, s, a, m,
     sum(CASE type(r)
           WHEN 'AUTHORED' THEN 3.0
           WHEN 'REVIEWED' THEN 2.0
           WHEN 'ASSIGNED' THEN 1.0
           ELSE 0.5 * (CASE WHEN coalesce(r.messages, 1) >= 4 THEN 4 ELSE coalesce(r.messages, 1) END) / 4.0
         END * exp(-($asOfDay - a.day) / 30.0)) AS contrib
WITH p, s, a, contrib,
     contrib * coalesce(m.weight, 1.0)
       * (CASE WHEN toLower(coalesce(a.title, '')) CONTAINS toLower(s.name) THEN 4.0 ELSE 1.0 END)
       / coalesce(a.mentionedSystems, 1) AS relevance
ORDER BY relevance DESC
WITH p, s, sum(contrib) AS score, max(a.day) AS lastDay, collect(a.id)[0..5] AS evidence
MERGE (p)-[k:KNOWS]->(s)
SET k.score = score, k.lastDay = lastDay, k.evidence = evidence
```

Changes:
- PARTICIPATED counts 0.5 x min(messages, 4) / 4: taking part in a conversation is weaker evidence than writing a document.
- All KNOWS edges are deleted before the query and edges below 0.05 after it, so a refresh "as of" an earlier day leaves nothing newer behind.
- Evidence is the five artifacts most *about* the system, not the first five found: each artifact's share of the score,
  times its MENTIONS weight, x4 when its title names the system, divided by how many systems it mentions (a stack list
  naming eight systems is about none of them). The score is the same sum, grouped per artifact first (on apex: 10,801
  KNOWS, total score unchanged). `mentionedSystems` is counted once beforehand; counting it per row timed out.

## K3a. Who knows this system

Purpose: the five strongest active experts on a system, with evidence ids.
Graph: `apex`.

```cypher
MATCH (s:System {name:$system})<-[k:KNOWS]-(:Person {active:true})
WITH s, max(k.score) AS top
MATCH (s)<-[k:KNOWS]-(p:Person {active:true})
RETURN p.name AS person, k.score AS score, round(100.0 * k.score / top) / 100.0 AS relativeScore,
       k.lastDay AS lastActive, k.evidence AS evidence
ORDER BY score DESC LIMIT 5
```

Changes:
- `relativeScore`: the score as a share of the top active expert (1 = the strongest). The raw score is an unbounded
  decayed sum; the `who_knows` MCP tool gives the agent only `relativeScore`, so answers never quote "100.47".

## K3b. Evidence path for one person and system

Purpose: the person's ten artifacts most about the system, as graph paths
for the UI canvas.
Graph: `apex`.

```cypher
MATCH path = (p:Person {name:$person})-[:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(a:Artifact)-[m:MENTIONS]->(s:System {name:$system})
RETURN path
ORDER BY coalesce(m.weight, 1.0)
           * (CASE WHEN toLower(coalesce(a.title, '')) CONTAINS toLower(s.name) THEN 4.0 ELSE 1.0 END)
           / coalesce(a.mentionedSystems, 1) DESC,
         a.day DESC
LIMIT 10
```

Changes:
- Includes PARTICIPATED: threads and meetings are evidence too.
- Ranked like K2's evidence, then newest first (it was newest first only, which surfaced pages naming the system in passing).

## K4. Bus factor

Purpose: how many experts each core system has (0 orphaned, 1 critical, 2 watch, 3+ ok).
Graph: `apex_proj`, or a what-if copy of it.

```cypher
MATCH (s:System)
WHERE s.core = true
OPTIONAL MATCH (s)<-[kt:KNOWS]-(:Person {active:true})
WITH s, max(kt.score) AS top
OPTIONAL MATCH (s)<-[k:KNOWS]-(p:Person {active:true})
WHERE k.score >= $minScore AND k.score >= $topShare * top
WITH s, count(p) AS experts, collect(p.name) AS names, collect(k.evidence) AS evidence
RETURN s.name AS system, experts, names, evidence
ORDER BY experts ASC
```

Changes:
- Returns evidence per expert, so every answer can cite artifacts.
- Core systems only: most extracted systems are named once or twice and would bury the real risks.
- An expert also needs $topShare (25%) of the system's top score, so "expert" means close to the people who know it best.

## K5. Departure impact: systems at risk

Purpose: the core systems a person is an expert on, and how many other experts (backups) each has.
Graph: `apex`.

```cypher
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
```

Changes:
- Returns the leaver's evidence ids for each system.
- Core systems only, and the same expert rule as K4 for the leaver and the backups.
- Backups are measured against the top score of the people who remain (the rule as it applies after the departure), so K5 agrees with the what-if simulation.

## K6. Departure impact: open tickets and suggested owners

Purpose: the open tickets a person owns, each with up to three people who could take it over.
Graph: `apex`.

```cypher
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
```

Changes:
- Status is read from the ASSIGNED edge, case-insensitively, and a missing status counts as open (otherwise those tickets silently disappear).
- Fit is weighted by each system's specificity, `s.idf = log(totalArtifacts / (1 + mentionCount))`, so a niche system counts more than one named everywhere.
- Workload penalty `fit / (1 + openTickets / 5)`: someone already holding many open tickets is suggested less often.
- Returns evidence ids for each suggested owner.

## K7. Departure impact: pages nobody else has touched

Purpose: pages the person wrote that no one else has authored or reviewed.
Graph: `apex`.

```cypher
MATCH (p:Person {name:$person})-[:AUTHORED]->(d:Page)
OPTIONAL MATCH (d)<-[:AUTHORED|REVIEWED]-(o:Person)
WHERE o <> p
WITH d, count(o) AS others
WHERE others = 0
RETURN d.id AS page, d.title AS title
```

## K8a. Collaboration network (COLLAB)

Purpose: connect people who worked on the same artifacts, weighted by how many they share.
Graph: `apex` (existing COLLAB edges are deleted first).

```cypher
MATCH (a:Person)-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED|PARTICIPATED]-(b:Person)
WHERE id(a) < id(b)
WITH a, b, count(x) AS w
MERGE (a)-[c:COLLAB]->(b)
SET c.weight = w
```

Changes:
- Includes PARTICIPATED, so conversations still connect people.
- The projection keeps only pairs at or above the median weight and writes each in both directions, because almost every pair shares some thread (a near-complete graph has flat betweenness) and FalkorDB's betweenness follows edge direction.

## K8b. Bridge people

Purpose: the ten people who connect otherwise separate groups (betweenness centrality).
Graph: `apex_proj`, or a what-if copy of it.

```cypher
CALL algo.betweenness({nodeLabels:['Person'], relationshipTypes:['COLLAB'], samplingSize: 1000, samplingSeed: 7})
YIELD node, score
RETURN node.name AS person, score
ORDER BY score DESC LIMIT 10
```

Changes:
- A fixed `samplingSeed` and 1000 samples: FalkorDB estimates betweenness from randomly sampled start nodes, so by default the scores changed every time the projection was rebuilt. With the seed they repeat exactly; scores are only comparable between runs with the same settings.

Each bridge person is returned with up to five artifacts they share with other departments, as evidence.

## K8c. Central people (not in the spec)

Purpose: who sits at the centre of the collaboration network. Betweenness (K8b) finds the people who connect teams;
PageRank finds the people whose colleagues are themselves well connected. Graph: `apex_proj` (COLLAB both ways).

```cypher
CALL algo.pageRank('Person', 'COLLAB')
YIELD node, score
RETURN node.name AS person, score
ORDER BY score DESC LIMIT 10
```

## K9. What-if knowledge islands

Purpose: systems that nobody connects to any more once a person is removed.
Graph: a `GRAPH.COPY` of `apex_proj` (`apex_whatif_<id>`), never `apex`. The person
is deleted in the copy; K4, K8b and this query are rerun there and compared with
`apex_proj`; the copy is always deleted afterwards.

```cypher
CALL algo.WCC({nodeLabels:['Person','System'], relationshipTypes:['KNOWS']})
YIELD node, componentId
WITH componentId, collect(node) AS members
WHERE all(m IN members WHERE m:System)
UNWIND members AS orphan
RETURN orphan.name AS orphanedSystem
```

## K10a. Decision trace for a system

Purpose: every decision about a system, newest first, with where it was made, by whom, and what it replaced.
Graph: `apex`.

```cypher
MATCH (d:Decision)-[:ABOUT]->(s:System {name:$system})
MATCH (d)-[:DECIDED_IN]->(src:Artifact)
OPTIONAL MATCH (src)<-[:AUTHORED|PARTICIPATED]-(who:Person)
OPTIONAL MATCH (d)-[:SUPERSEDES]->(old:Decision)
RETURN d.id AS id, d.summary AS summary, d.day AS day, d.kind AS kind, d.status AS status,
       src.id AS source, src.type AS sourceType, collect(DISTINCT who.name) AS authors,
       old.id AS replacedId, old.summary AS replaced
ORDER BY day DESC
```

Changes:
- The author match is optional and authors are collected: external emails have no employee author, and threads and meetings have several people (one row per decision, not per author).
- Authors include PARTICIPATED, so decisions made in meetings and threads name the people who took part.
- Explicit column names and ids, so answers can cite the decision and its source.

## K10b. Stale documentation

Purpose: pages that still state a decision that a later decision replaced.
Graph: `apex`.

```cypher
MATCH (newer:Decision)-[:SUPERSEDES]->(old:Decision)<-[:ASSERTS]-(page:Page)
OPTIONAL MATCH (newer)-[:DECIDED_IN]->(src:Artifact)
RETURN page.id AS stalePage, page.title AS pageTitle, old.id AS outdatedId, old.summary AS outdatedClaim,
       newer.id AS currentId, newer.summary AS currentDecision, newer.day AS decidedOn, src.id AS decidedIn
```

Changes:
- Also returns the page title, both decision ids and where the newer decision was made, for citations.
- SUPERSEDES between two decisions from the same artifact are rejected when links are written: a document does not make itself stale.

## K11. Hybrid retrieval

Purpose: semantic search over artifact chunks, expanded with linked artifacts and the people involved.
Graph: `apex`.

```cypher
CALL db.idx.vector.queryNodes('Chunk', 'embedding', $k, vecf32($q)) YIELD node, score
MATCH (node)-[:PART_OF]->(a:Artifact)
WHERE $asOfDay IS NULL OR a.day <= $asOfDay
OPTIONAL MATCH (a)-[:REFERENCES*1..2]-(linked:Artifact)
WHERE linked <> a
OPTIONAL MATCH (a)<-[:AUTHORED|PARTICIPATED]-(author:Person)
RETURN node.id AS chunkId, a.id AS id, a.title AS title, a.type AS type, a.day AS day, score,
       collect(DISTINCT linked.id)[0..8] AS related, collect(DISTINCT author.name) AS authors
ORDER BY score ASC
```

Changes:
- `score` is a cosine distance in FalkorDB, so results are ordered ascending (nearest first).
- Optional "as of day" filter, applied after the vector call (vector queries take no property filters).
- An artifact does not list itself as related through a two-hop loop.
- Authors include PARTICIPATED, the people in a thread or meeting.

## M. Agent memory (Stage 16)

Code: `apps/api/src/memory/queries/memory.queries.ts`. Graph: `apex`. Memory nodes (`User`, `Session`,
`Turn`, `Feedback`, `Note`) are written by people using the app, never from `artifacts.jsonl` or the
answer key, and are exported and restored like Actions (`EXPORT_MEMORY`, `RESTORE_MEMORY_*` in
`apps/api/src/backup/queries/backup.queries.ts`). Their edges to systems and people are `CONCERNS`,
kept apart from the Decision `ABOUT` edges.

### M1. Store an answered question

```cypher
MERGE (u:User {id: $userId}) ON CREATE SET u.firstAt = $at
MERGE (s:Session {id: $sessionId}) ON CREATE SET s.startedAt = $at, s.title = $title, s.turns = 0
MERGE (u)-[:STARTED]->(s)
SET s.lastAt = $at, s.turns = s.turns + 1
CREATE (t:Turn {id: $id, n: s.turns, question: $question, summary: $summary, label: $label, outcome: $outcome,
                tools: $tools, at: $at, day: $day, latencyMs: $latencyMs}),
       (s)-[:HAS_TURN]->(t)
WITH s, t
OPTIONAL MATCH (s)-[:HAS_TURN]->(prev:Turn) WHERE prev.n = t.n - 1
FOREACH (x IN CASE WHEN prev IS NULL THEN [] ELSE [prev] END | CREATE (x)-[:NEXT]->(t))
RETURN t.id AS id, t.n AS n
```

Then `(t)-[:CITED]->(:Artifact)` for its valid citations and `(t)-[:CONCERNS]->(:System|:Person)` for the
subjects named in the question or in the tool arguments (`who_knows {system}`, `simulate_departure {person}`).

### M2. The chat so far (before a follow-up)

```cypher
MATCH (:Session {id: $sessionId})-[:HAS_TURN]->(t:Turn)
WITH t ORDER BY t.n DESC LIMIT $limit
OPTIONAL MATCH (t)-[:CITED]->(a:Artifact)
WITH t, collect(DISTINCT a.id) AS cited
OPTIONAL MATCH (t)-[:CONCERNS]->(x)
RETURN t.id AS id, t.n AS n, t.question AS question, t.summary AS summary, cited, collect(DISTINCT x.name) AS subjects
ORDER BY n
```

### M3. Who and what a text names

`$terms` are the text's lower-cased words and runs of up to four words, matched exactly (so "Tom" never
matches "tomorrow"), against core system names and aliases and against people:

```cypher
MATCH (s:System)
WHERE s.core = true
  AND (toLower(s.name) IN $terms OR any(alias IN coalesce(s.aliases, []) WHERE toLower(alias) IN $terms))
RETURN s.name AS name
```

### M4. Approved notes about the question's subjects

```cypher
MATCH (n:Note {status: 'approved'})-[:CONCERNS]->(x)
WHERE x.name IN $names AND (x:System OR x:Person)
WITH DISTINCT n
RETURN n.id AS id, n.text AS text, n.day AS day
ORDER BY n.createdAt DESC LIMIT $limit
```

### M5. A correction becomes a proposed note

```cypher
MATCH (t:Turn {id: $turnId})
MERGE (u:User {id: $userId}) ON CREATE SET u.firstAt = $at
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
```

A person approves it with `SET n.status = 'approved'` (only while it is `proposed`); there is no MCP tool for that.

### M6. What Keystone remembers about a subject (`recall_memory`)

```cypher
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
```

## L. Live documents (Stage 17)

Code: `apps/api/src/live/queries/live.queries.ts`, `CANDIDATE_BY_ID` and `SYSTEMS_FOR_LINKING_IN` in
`apps/api/src/extract/queries/extract.queries.ts`. A posted document goes through the corpus queries (ingest MERGEs,
`MERGE_MENTIONS`, `MERGE_DECISIONS`, `MERGE_SUPERSEDES`), so after it K10b finds the pages it made stale:

```cypher
// The earlier decisions about the systems a new document decides on (the live-links prompt shortlists them)
MATCH (s:System) WHERE s.name IN $systems
OPTIONAL MATCH (d:Decision)-[:ABOUT]->(s)
WITH s, d ORDER BY coalesce(d.day, 1000000), d.id
WITH s, collect(CASE WHEN d IS NULL THEN NULL ELSE {id: d.id, day: d.day, summary: d.summary} END) AS decisions
...
```

Reset removes every live document with what it added, and puts back what it changed:

```cypher
// People whose departure only a live document announced
MATCH (p:Person)-[:DEPARTURE_ANNOUNCED_IN]->(:Artifact {live: true})
WITH DISTINCT p
OPTIONAL MATCH (p)-[d:DEPARTURE_ANNOUNCED_IN]->(other:Artifact) WHERE other.live IS NULL
WITH p, min(d.departedDay) AS corpusDay
SET p.departedDay = corpusDay

// The documents, their chunks and the decisions made in them
MATCH (a:Artifact {live: true})
OPTIONAL MATCH (c:Chunk)-[:PART_OF]->(a)
OPTIONAL MATCH (d:Decision)-[:DECIDED_IN]->(a)
WITH collect(DISTINCT a) + collect(DISTINCT c) + collect(DISTINCT d) AS doomed
UNWIND doomed AS x
DETACH DELETE x

// Decisions only they had replaced are active again
MATCH (d:Decision {status: 'superseded'}) WHERE NOT ()-[:SUPERSEDES]->(d)
SET d.status = 'active'
```

## P. How two things are connected (`how_connected`)

Code: `SHORTEST_PERSON_TO_SYSTEM`, `SHORTEST_PERSON_TO_PERSON`, `SHORTEST_SYSTEM_TO_SYSTEM`, `SHARED_ARTIFACTS` in
`apps/api/src/analytics/queries/analytics.queries.ts`. FalkorDB's `shortestPath()` is directed only, and `COLLAB` is stored
once per pair, so the procedure `algo.SPpaths` is used in both directions. Between two people a chain may use `COLLAB` only;
with a system it may use work edges and `MENTIONS` too.

```cypher
MATCH (a:Person {name: $from}), (b:System {name: $to})
CALL algo.SPpaths({sourceNode: a, targetNode: b, relTypes: $relTypes, relDirection: 'both', maxLen: 5, pathCount: 1})
YIELD path
RETURN path
```

Each `COLLAB` step then gets its evidence: the two most recent artifacts both people worked on.

```cypher
UNWIND $pairs AS pair
MATCH (x:Person {name: pair[0]})-[:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]->(art:Artifact)<-[:AUTHORED|REVIEWED|ASSIGNED|PARTICIPATED]-(y:Person {name: pair[1]})
WITH pair, art ORDER BY art.day DESC
WITH pair, collect(DISTINCT art.id)[0..2] AS shared
RETURN pair[0] AS a, pair[1] AS b, shared
```
