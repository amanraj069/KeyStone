import type { ArtifactRecord } from '../src/ingest/artifact-record';

/** Builds an ArtifactRecord for unit tests; only the fields a test cares about need passing. */
export function record(overrides: Partial<ArtifactRecord> & Pick<ArtifactRecord, 'doc_id' | 'doc_type'>): ArtifactRecord {
  return {
    title: '',
    body: '',
    day: 1,
    date: '2026-01-01',
    dept: null,
    is_incident: false,
    actors: [],
    tags: [],
    artifact_ids: {},
    facts: {},
    ...overrides,
  };
}

/**
 * A miniature company in artifacts.jsonl shape:
 *   employees Ada (Engineering_Backend, sprint owner), Bo (Product, by meetings),
 *   Cy (new hire: personal address, then speaks in Slack);
 *   Nora is a vendor (external address only); GitHub is a bot.
 */
export const MINI_RECORDS: ArtifactRecord[] = [
  record({ doc_id: 'ENG-1', doc_type: 'jira', day: 1, dept: 'Engineering_Backend', actors: ['Ada'], title: 'Build pipeline', facts: { sprint_number: 1, status: 'To Do' } }),
  record({ doc_id: 'zoom_1', doc_type: 'zoom_transcript', day: 1, dept: 'Product', actors: ['Ada', 'Bo'], body: '# Zoom\n**[10:00:00] Bo:** hi\n**[10:01:00] Ada:** hello' }),
  record({ doc_id: 'zoom_2', doc_type: 'zoom_transcript', day: 2, dept: 'Product', actors: ['Bo'], body: '**[11:00:00] Bo:** plan' }),
  record({ doc_id: 'slack_product_2026-01-02T09:00:00', doc_type: 'slack', day: 2, actors: ['Bo', 'Cy', 'GitHub', 'Ada'], body: 'Bo: morning\nCy: hello all\nGitHub: build passed' }),
  record({ doc_id: 'slack_product_2026-01-05T09:00:00', doc_type: 'slack', day: 3, actors: ['Cy'], body: 'Cy: update' }),
  record({ doc_id: 'slack_product_2026-01-06T09:00:00', doc_type: 'slack', day: 4, actors: ['Cy'], body: 'Cy: another' }),
  record({ doc_id: 'CONF-1', doc_type: 'confluence', day: 2, actors: ['Bo'], title: 'Runbook', body: '# Runbook\n**Author:** Ada\n', artifact_ids: { jira: 'ENG-1' } }),
  record({ doc_id: 'PR-1', doc_type: 'pr', day: 3, actors: ['Ada'], title: '[ENG-1] Fix pipeline', facts: { author: 'Ada', reviewer: 'Bo', pr_title: '[ENG-1] Fix pipeline' } }),
  record({ doc_id: 'email_in', doc_type: 'email', day: 3, actors: ['Nora', 'Ada'], facts: { from_addr: 'Nora <nora@vendor.example>', to_addr: 'Ada <ada@apex.example>', causal_chain: ['ENG-1', 'missing-id'] } }),
  record({ doc_id: 'email_out', doc_type: 'email', day: 4, actors: ['Ada', 'Nora'], facts: { from_addr: 'Ada <ada@apex.example>', to_addr: 'Nora <nora@vendor.example>', sent_by: 'Ada' } }),
  record({ doc_id: 'email_offer', doc_type: 'email', day: 1, actors: ['Bo', 'Cy'], facts: { from_addr: 'Bo <bo@apex.example>', to_addr: 'Cy <cy@personal.example>' } }),
  record({ doc_id: 'DD-1', doc_type: 'datadog_alert', day: null, dayUnknown: true, date: null, actors: [], is_incident: true }),
];
