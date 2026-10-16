Here are the spec queries. First save this whole message as docs/spec-queries.md (so later stages can read it), then continue Stage 7 using K2-K8 and K10. Keep the Cypher as written; only change what FalkorDB rejects or what our actual graph requires (for example where ticket status is stored), and list every change you make.

K1 is already done in Stage 3. K9 is used in Stage 8 and K11 was implemented in Stage 6; they are included for reference.

## K2. Materialise recency-weighted expertise (run on apex)
// Authoring counts 3, reviewing 2, ticket ownership 1; exponential decay with a 30-day time constant.
// Artifacts with day null (dayUnknown) are skipped by the WHERE.
MATCH (p:Person)-[r:AUTHORED|ASSIGNED|REVIEWED]->(a:Artifact)-[:MENTIONS]->(s:System)
WHERE a.day IS NOT NULL AND a.day <= $asOfDay
WITH p, s,
     sum(CASE type(r) WHEN 'AUTHORED' THEN 3.0 WHEN 'REVIEWED' THEN 2.0 ELSE 1.0 END
         * exp(-($asOfDay - a.day) / 30.0)) AS score,
     max(a.day) AS lastDay,
     collect(a.id)[0..5] AS evidence
MERGE (p)-[k:KNOWS]->(s)
SET k.score = score, k.lastDay = lastDay, k.evidence = evidence

## K3a. Who knows this system (apex)
MATCH (s:System {name:$system})<-[k:KNOWS]-(p:Person {active:true})
RETURN p.name AS person, k.score AS score, k.lastDay AS lastActive, k.evidence AS evidence
ORDER BY score DESC LIMIT 5

## K3b. Evidence path for one person and system (apex)
MATCH path = (p:Person {name:$person})-[:AUTHORED|REVIEWED|ASSIGNED]->(a:Artifact)-[:MENTIONS]->(s:System {name:$system})
RETURN path ORDER BY a.day DESC LIMIT 10

## K4. Bus factor for every system (apex_proj, or any graph passed in)
MATCH (s:System)
OPTIONAL MATCH (s)<-[k:KNOWS]-(p:Person {active:true})
WHERE k.score >= $minScore
WITH s, count(p) AS experts, collect(p.name) AS names
RETURN s.name AS system, experts, names
ORDER BY experts ASC

## K5. Departure impact: systems that lose their only expert (apex)
MATCH (leaver:Person {name:$person})-[k:KNOWS]->(s:System)
WHERE k.score >= $minScore
OPTIONAL MATCH (s)<-[k2:KNOWS]-(other:Person {active:true})
WHERE other <> leaver AND k2.score >= $minScore
WITH s, k, count(other) AS backups, collect(other.name) AS backupNames
RETURN s.name AS system, k.score AS leaverScore, backups, backupNames
ORDER BY backups ASC, leaverScore DESC

## K6. Departure impact: orphaned open tickets and suggested owners (apex)
// Adapt the status check to where Stage 4 stored ticket status (node property or ASSIGNED edge)
// and pass the real "closed" status values from the data as $doneStatuses.
MATCH (:Person {name:$person})-[asg:ASSIGNED]->(t:Ticket)
WHERE NOT coalesce(t.status, asg.status) IN $doneStatuses
OPTIONAL MATCH (t)-[:MENTIONS]->(:System)<-[k:KNOWS]-(cand:Person {active:true})
WHERE cand.name <> $person
WITH t, cand, sum(k.score) AS fit
ORDER BY fit DESC
RETURN t.id AS ticket, t.title AS title, collect(cand.name)[0..3] AS suggestedOwners

## K7. Departure impact: pages nobody else has touched (apex)
MATCH (p:Person {name:$person})-[:AUTHORED]->(d:Page)
OPTIONAL MATCH (d)<-[:AUTHORED|REVIEWED]-(o:Person)
WHERE o <> p
WITH d, count(o) AS others
WHERE others = 0
RETURN d.id AS page, d.title AS title

## K8a. Collaboration projection (apex; delete existing COLLAB edges first)
MATCH (a:Person)-[:AUTHORED|ASSIGNED|REVIEWED]->(x:Artifact)<-[:AUTHORED|ASSIGNED|REVIEWED]-(b:Person)
WHERE id(a) < id(b)
WITH a, b, count(x) AS w
MERGE (a)-[c:COLLAB]->(b)
SET c.weight = w

## K8b. Bridge people (apex_proj, or any graph passed in)
CALL algo.betweenness({nodeLabels:['Person'], relationshipTypes:['COLLAB']})
YIELD node, score
RETURN node.name AS person, score
ORDER BY score DESC LIMIT 10

## K9. What-if knowledge islands (Stage 8; runs on a GRAPH.COPY of apex_proj, never apex)
// Steps: copy apex_proj to apex_whatif_<id>; DETACH DELETE the person in the copy;
// rerun K4, K8b and the query below on the copy; diff against apex_proj; always delete the copy.
CALL algo.WCC({nodeLabels:['Person','System'], relationshipTypes:['KNOWS']})
YIELD node, componentId
WITH componentId, collect(node) AS members
WHERE all(m IN members WHERE m:System)
UNWIND members AS orphan
RETURN orphan.name AS orphanedSystem

## K10a. Decision trace for a system (apex)
MATCH (d:Decision)-[:ABOUT]->(s:System {name:$system})
MATCH (d)-[:DECIDED_IN]->(src:Artifact)<-[:AUTHORED]-(who:Person)
OPTIONAL MATCH (d)-[:SUPERSEDES]->(old:Decision)
RETURN d.summary, d.day, src.id, src.type, who.name, old.summary AS replaced
ORDER BY d.day DESC

## K10b. Stale docs (apex)
MATCH (newer:Decision)-[:SUPERSEDES]->(old:Decision)<-[:ASSERTS]-(page:Page)
RETURN page.id AS stalePage, old.summary AS outdatedClaim, newer.summary AS currentDecision

## K11. Hybrid retrieval (already implemented in Stage 6; reference only)
CALL db.idx.vector.queryNodes('Chunk', 'embedding', $k, vecf32($q)) YIELD node, score
MATCH (node)-[:PART_OF]->(a:Artifact)
OPTIONAL MATCH (a)-[:REFERENCES*1..2]-(linked:Artifact)
OPTIONAL MATCH (a)<-[:AUTHORED]-(author:Person)
RETURN node.id AS chunkId, a.id AS id, a.title AS title, a.type AS type, a.day AS day, score,
       collect(DISTINCT linked.id)[0..8] AS related, collect(DISTINCT author.name) AS authors
ORDER BY score DESC

Notes:
- K10a only matches decisions whose source artifact has an author. If Meeting decisions have no AUTHORED edge in our graph, change that MATCH to OPTIONAL MATCH for the author and tell me.
- Before K6, print the distinct ticket status values in apex and propose $doneStatuses.
- Don't commit anything.
