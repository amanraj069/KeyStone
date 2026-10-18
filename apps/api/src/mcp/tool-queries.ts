import * as Actions from '../actions/queries/actions.queries';
import * as A from '../analytics/queries/analytics.queries';
import * as Art from '../artifacts/queries/artifacts.queries';
import * as M from '../memory/queries/memory.queries';
import * as R from '../retrieval/queries/retrieval.queries';
import * as W from '../whatif/queries/whatif.queries';

/** One Cypher query as the UI shows it: the exact constant the code runs. */
export interface QueryEntry {
  id: string;
  title: string;
  /** Where it lives, so it can be found in the repo. */
  file: string;
  cypher: string;
}

const entry = (id: string, title: string, file: string, cypher: string): QueryEntry => ({ id, title, file, cypher: cypher.trim() });

const ANALYTICS = 'apps/api/src/analytics/queries/analytics.queries.ts';
const ARTIFACTS = 'apps/api/src/artifacts/queries/artifacts.queries.ts';
const WHATIF = 'apps/api/src/whatif/queries/whatif.queries.ts';

/** Every query a tool can run, by id (the K numbers follow docs/spec-queries.md). */
export const QUERIES: Record<string, QueryEntry> = Object.fromEntries(
  [
    entry('K2', 'Recency-weighted expertise (KNOWS), materialised by the refresh', ANALYTICS, A.K2_MATERIALISE_KNOWS),
    entry('K3a', 'Who knows this system', ANALYTICS, A.K3A_SYSTEM_EXPERTS),
    entry('K3b', 'Evidence path for the top expert', ANALYTICS, A.K3B_EVIDENCE_PATH),
    entry('K3c', "Titles and roles of each expert's evidence", ANALYTICS, A.K3C_EXPERT_SOURCES),
    entry('K4', 'Bus factor (on apex_proj)', ANALYTICS, A.K4_BUS_FACTOR),
    entry('K5', 'Departure impact: systems at risk', ANALYTICS, A.K5_DEPARTURE_SYSTEMS),
    entry('K6', 'Departure impact: open tickets and suggested owners', ANALYTICS, A.K6_DEPARTURE_TICKETS),
    entry('K7', 'Departure impact: pages nobody else touched', ANALYTICS, A.K7_DEPARTURE_PAGES),
    entry('K8b', 'Bridge people (betweenness on COLLAB)', ANALYTICS, A.K8B_BRIDGES),
    entry('K8c', 'Central people (PageRank on COLLAB)', ANALYTICS, A.K8C_CENTRAL_PEOPLE),
    entry('K9', 'Knowledge islands (connected components)', WHATIF, W.K9_KNOWLEDGE_ISLANDS),
    entry('W-REMOVE', 'Remove the person from the scratch copy', WHATIF, W.REMOVE_PERSON),
    entry('W-COPY', 'Copy the projection to a scratch graph', 'apps/api/src/whatif/whatif.service.ts', 'GRAPH.COPY apex_proj apex_whatif_<timestamp>_<id>'),
    entry('K10a', 'Decision trace for a system', ANALYTICS, A.K10A_DECISION_TRACE),
    entry('K10b', 'Stale documentation', ANALYTICS, A.K10B_STALE_DOCS),
    entry('K11', 'Hybrid retrieval: vector index plus graph expansion', 'apps/api/src/retrieval/queries/retrieval.queries.ts', R.HYBRID_SEARCH),
    entry('LIST-SYSTEMS', 'Core systems', ANALYTICS, A.LIST_CORE_SYSTEMS),
    entry('LIST-PEOPLE', 'People', ANALYTICS, A.LIST_PEOPLE),
    entry('ART-FIND', 'Documents by people, day range, type or text', ARTIFACTS, Art.FIND_ARTIFACTS),
    entry('ART-DETAIL', 'One document with its people and links', ARTIFACTS, Art.ARTIFACT_DETAIL),
    entry('ART-FOLLOWED', 'What followed a document', ARTIFACTS, Art.WHAT_FOLLOWED),
    entry('ART-EVENT', 'Candidate documents of an event', ARTIFACTS, Art.FIND_EVENT_CANDIDATES),
    entry('ART-FOLLOW-UP', 'Did a response follow? (verdict)', ARTIFACTS, Art.CHECK_FOLLOW_UP),
    entry('ART-INVOLVED', 'Was the person involved by that day? (verdict)', ARTIFACTS, Art.CHECK_INVOLVEMENT),
    entry('ART-CAUSAL', 'Are two events linked? (verdict)', ARTIFACTS, Art.CHECK_CAUSAL_LINK),
    entry('ACT-HANDOVER', 'Propose a handover plan', 'apps/api/src/actions/queries/actions.queries.ts', Actions.CREATE_HANDOVER_PLAN),
    entry('ACT-REASSIGN', 'Propose moving a ticket', 'apps/api/src/actions/queries/actions.queries.ts', Actions.CREATE_REASSIGN_PROPOSAL),
    entry('ACT-RUNBOOK', 'Propose a runbook task', 'apps/api/src/actions/queries/actions.queries.ts', Actions.CREATE_RUNBOOK_TASK),
    entry('PATH-SYSTEM', 'Shortest path from a person to a system', ANALYTICS, A.SHORTEST_PERSON_TO_SYSTEM),
    entry('PATH-PERSON', 'Shortest chain of collaborators between two people', ANALYTICS, A.SHORTEST_PERSON_TO_PERSON),
    entry('PATH-SYSTEMS', 'Shortest chain between two systems', ANALYTICS, A.SHORTEST_SYSTEM_TO_SYSTEM),
    entry('PATH-SHARED', 'Documents each pair on the chain worked on together', ANALYTICS, A.SHARED_ARTIFACTS),
    entry('M-RECALL', 'What Keystone remembers about a subject', 'apps/api/src/memory/queries/memory.queries.ts', M.RECALL),
    entry('T1', 'Incident triage: the incident and its systems (through REFERENCES)', ANALYTICS, A.T1_TRIAGE_INCIDENT),
    entry('T2', 'Incident triage: who can respond now (active, by KNOWS)', ANALYTICS, A.T2_TRIAGE_RESPONDERS),
    entry('T3', 'Incident triage: earlier incidents and the PRs that fixed them', ANALYTICS, A.T3_TRIAGE_PAST_INCIDENTS),
  ].map((q) => [q.id, q]),
);

/** The queries behind each MCP tool, in the order the tool runs them. */
export const TOOL_QUERIES: Record<string, string[]> = {
  search_knowledge: ['K11'],
  find_artifacts: ['ART-FIND'],
  get_artifact: ['ART-DETAIL'],
  what_followed: ['ART-FOLLOWED'],
  find_event: ['ART-EVENT'],
  check_follow_up: ['ART-FOLLOW-UP'],
  check_visibility: ['ART-EVENT', 'ART-INVOLVED'],
  check_involvement: ['ART-INVOLVED'],
  check_causal_link: ['ART-CAUSAL'],
  who_knows: ['K3a', 'K3c', 'K3b'],
  bus_factor: ['K4'],
  bridge_people: ['K8b'],
  central_people: ['K8c'],
  how_connected: ['PATH-SYSTEM', 'PATH-PERSON', 'PATH-SYSTEMS', 'PATH-SHARED'],
  triage_incident: ['T1', 'T2', 'T3'],
  simulate_departure: ['W-COPY', 'W-REMOVE', 'K4', 'K8b', 'K9', 'K5', 'K6', 'K7'],
  trace_decision: ['K10a'],
  find_stale_docs: ['K10b'],
  list_systems: ['LIST-SYSTEMS'],
  list_people: ['LIST-PEOPLE'],
  draft_handover: ['K5', 'K6', 'K7', 'ACT-HANDOVER'],
  propose_reassignment: ['ACT-REASSIGN'],
  create_runbook_task: ['ACT-RUNBOOK'],
  recall_memory: ['M-RECALL'],
};
