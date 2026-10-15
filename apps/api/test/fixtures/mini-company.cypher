// mini-company.cypher: a tiny, hand-checkable company for integration tests.
// Loaded by test/fixture-loader.ts (comment lines are stripped, statements split on ';').
// Labels follow AGENTS.md section 5. Only raw evidence is stored here; derived
// edges (KNOWS, COLLAB, PART_OF, ...) are computed by later stages, not faked.
//
// PEOPLE (5) in 2 departments
//   Engineering_Backend: Ada, Ben, Cara (Cara left on day 12: active false, lastDay 12)
//   Product:             Dev, Eve
//
// SYSTEMS (4): TitanDB, PaymentsAPI, LegacyAuth, MobileApp
//
// ARTIFACTS (13): 4 Ticket, 3 PR, 3 Page, 2 Thread, 1 Meeting
//   P-2 has day: null and dayUnknown: true; any "a.day <= $day" filter must skip it.
//
// Definitions used by the expectations below:
//   evidence(person, system) = person AUTHORED, REVIEWED or was ASSIGNED an
//                              artifact that MENTIONS the system
//   active expert            = active person with evidence on the system
//   collaboration            = two people linked to the same artifact
//
// EXPECTATIONS (tests and later stages rely on these)
//   1. Exactly one system has a SINGLE active expert:  PaymentsAPI -> Ada only
//        (P-1 and TH-1 are both Ada's).
//   2. Exactly one system has NO active expert:         LegacyAuth -> only Cara (inactive)
//        (P-2 and TH-2 are both Cara's).
//   3. The other two systems have several active experts:
//        TitanDB   -> Ada, Ben, Dev   (+ Cara, inactive)
//        MobileApp -> Ada, Ben, Dev, Eve
//   4. Dev is the ONLY bridge between the two departments.
//        Collaboration pairs: Ada-Ben (T-1, PR-1), Ben-Cara (PR-2), Ada-Cara (T-2),
//        Eve-Dev (T-3), Ada-Dev (T-4), Dev-Ben (PR-3).
//        Every cross-department pair includes Dev, and Dev is the only articulation
//        point: removing Dev cuts Eve off; removing Ada or Ben does not disconnect anyone.
//        So Dev has the highest betweenness.
//   5. Departure: Cara left on day 12 while ASSIGNED to T-2 with status "open"
//        (an unhandled ticket that needs reassignment).
//   6. Decisions about MobileApp: D-2 (day 10, active) SUPERSEDES D-1 (day 3, superseded).
//        D-2 was DECIDED_IN the Meeting M-1. Page P-3 still ASSERTS the old D-1, so
//        P-3 is a stale document.
//
// NODE COUNTS: Person 5, Dept 2, System 4, Artifact 13 (Ticket 4, PR 3, Page 3,
//              Thread 2, Meeting 1), Decision 2.

CREATE
  // Departments
  (eng:Dept {name: 'Engineering_Backend'}),
  (prod:Dept {name: 'Product'}),

  // People
  (ada:Person  {name: 'Ada',  dept: 'Engineering_Backend', firstDay: 1, lastDay: null, active: true}),
  (ben:Person  {name: 'Ben',  dept: 'Engineering_Backend', firstDay: 1, lastDay: null, active: true}),
  (cara:Person {name: 'Cara', dept: 'Engineering_Backend', firstDay: 1, lastDay: 12,   active: false}),
  (dev:Person  {name: 'Dev',  dept: 'Product',             firstDay: 1, lastDay: null, active: true}),
  (eve:Person  {name: 'Eve',  dept: 'Product',             firstDay: 1, lastDay: null, active: true}),
  (ada)-[:MEMBER_OF]->(eng), (ben)-[:MEMBER_OF]->(eng), (cara)-[:MEMBER_OF]->(eng),
  (dev)-[:MEMBER_OF]->(prod), (eve)-[:MEMBER_OF]->(prod),

  // Systems
  (titan:System    {name: 'TitanDB',     aliases: ['titan', 'titan db']}),
  (payments:System {name: 'PaymentsAPI', aliases: ['payments api']}),
  (legacy:System   {name: 'LegacyAuth',  aliases: ['legacy auth']}),
  (mobile:System   {name: 'MobileApp',   aliases: ['mobile app', 'ios app']}),

  // Artifacts (type = OrgForge doc_type; extra label from AGENTS.md section 5)
  (t1:Artifact:Ticket   {id: 'T-1',  type: 'jira',            title: 'TitanDB latency spike',            day: 3,    isIncident: true,  bodyLength: 820}),
  (t2:Artifact:Ticket   {id: 'T-2',  type: 'jira',            title: 'TitanDB backup job',               day: 7,    isIncident: false, bodyLength: 410}),
  (t3:Artifact:Ticket   {id: 'T-3',  type: 'jira',            title: 'MobileApp crash on login',         day: 5,    isIncident: true,  bodyLength: 640}),
  (t4:Artifact:Ticket   {id: 'T-4',  type: 'jira',            title: 'TitanDB stats on mobile dashboard', day: 11,   isIncident: false, bodyLength: 300}),
  (pr1:Artifact:PR      {id: 'PR-1', type: 'pr',              title: 'Fix TitanDB connection pool',      day: 4,    isIncident: false, bodyLength: 950}),
  (pr2:Artifact:PR      {id: 'PR-2', type: 'pr',              title: 'TitanDB index migration',          day: 9,    isIncident: false, bodyLength: 700}),
  (pr3:Artifact:PR      {id: 'PR-3', type: 'pr',              title: 'Mobile dashboard API client',      day: 12,   isIncident: false, bodyLength: 560}),
  (p1:Artifact:Page     {id: 'P-1',  type: 'confluence',      title: 'PaymentsAPI runbook',              day: 2,    isIncident: false, bodyLength: 2400}),
  (p2:Artifact:Page     {id: 'P-2',  type: 'confluence',      title: 'LegacyAuth token flow',            day: null, dayUnknown: true, isIncident: false, bodyLength: 1800}),
  (p3:Artifact:Page     {id: 'P-3',  type: 'confluence',      title: 'MobileApp release checklist',      day: 3,    isIncident: false, bodyLength: 1200}),
  (th1:Artifact:Thread  {id: 'TH-1', type: 'slack',           title: 'PaymentsAPI refund bug',           day: 6,    isIncident: false, bodyLength: 380}),
  (th2:Artifact:Thread  {id: 'TH-2', type: 'slack',           title: 'LegacyAuth session expiry',        day: 8,    isIncident: false, bodyLength: 290}),
  (m1:Artifact:Meeting  {id: 'M-1',  type: 'zoom_transcript', title: 'MobileApp architecture review',    day: 10,   isIncident: false, bodyLength: 5200}),

  // Who touched what (with the day it happened)
  (ada)-[:AUTHORED {day: 3}]->(t1),  (ben)-[:ASSIGNED {day: 3, status: 'done'}]->(t1),
  (ben)-[:AUTHORED {day: 4}]->(pr1), (ada)-[:REVIEWED {day: 5}]->(pr1),
  (cara)-[:AUTHORED {day: 9}]->(pr2), (ben)-[:REVIEWED {day: 10}]->(pr2),
  (ada)-[:AUTHORED {day: 7}]->(t2),  (cara)-[:ASSIGNED {day: 7, status: 'open'}]->(t2),
  (ada)-[:AUTHORED {day: 2}]->(p1),
  (ada)-[:AUTHORED {day: 6}]->(th1),
  (cara)-[:AUTHORED]->(p2),
  (cara)-[:AUTHORED {day: 8}]->(th2),
  (eve)-[:AUTHORED {day: 5}]->(t3),  (dev)-[:ASSIGNED {day: 5, status: 'done'}]->(t3),
  (dev)-[:AUTHORED {day: 10}]->(m1),
  (dev)-[:AUTHORED {day: 3}]->(p3),
  (ada)-[:AUTHORED {day: 11}]->(t4), (dev)-[:ASSIGNED {day: 11, status: 'in_progress'}]->(t4),
  (dev)-[:AUTHORED {day: 12}]->(pr3), (ben)-[:REVIEWED {day: 12}]->(pr3),

  // Which systems each artifact talks about
  (t1)-[:MENTIONS {weight: 3}]->(titan),
  (pr1)-[:MENTIONS {weight: 2}]->(titan),
  (pr2)-[:MENTIONS {weight: 2}]->(titan),
  (t2)-[:MENTIONS {weight: 1}]->(titan),
  (t4)-[:MENTIONS {weight: 1}]->(titan), (t4)-[:MENTIONS {weight: 1}]->(mobile),
  (p1)-[:MENTIONS {weight: 4}]->(payments),
  (th1)-[:MENTIONS {weight: 2}]->(payments),
  (p2)-[:MENTIONS {weight: 3}]->(legacy),
  (th2)-[:MENTIONS {weight: 1}]->(legacy),
  (t3)-[:MENTIONS {weight: 2}]->(mobile),
  (m1)-[:MENTIONS {weight: 3}]->(mobile),
  (p3)-[:MENTIONS {weight: 2}]->(mobile),
  (pr3)-[:MENTIONS {weight: 1}]->(mobile),

  // Decisions: D-2 replaced D-1 in the meeting; P-3 still documents D-1
  (d1:Decision {id: 'D-1', summary: 'MobileApp releases ship every two weeks', day: 3,  status: 'superseded'}),
  (d2:Decision {id: 'D-2', summary: 'MobileApp releases ship weekly',          day: 10, status: 'active'}),
  (d1)-[:ABOUT]->(mobile), (d2)-[:ABOUT]->(mobile),
  (d2)-[:SUPERSEDES {day: 10}]->(d1),
  (d2)-[:DECIDED_IN]->(m1),
  (p3)-[:ASSERTS]->(d1);
