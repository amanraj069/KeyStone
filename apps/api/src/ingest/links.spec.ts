import { fixesFor, referencesFor } from './links';
import { MINI_RECORDS } from '../../test/ingest-records';

const ids = new Set(MINI_RECORDS.map((r) => r.doc_id));
const types = new Map(MINI_RECORDS.map((r) => [r.doc_id, r.doc_type]));
const byId = (id: string) => MINI_RECORDS.find((r) => r.doc_id === id)!;

describe('referencesFor', () => {
  it('links artifact_ids values that are other artifacts, with the field as kind', () => {
    expect(referencesFor(byId('CONF-1'), ids)).toEqual([{ from: 'CONF-1', to: 'ENG-1', kind: 'jira' }]);
  });

  it('follows causal_chain and drops ids that are not artifacts', () => {
    expect(referencesFor(byId('email_in'), ids)).toEqual([{ from: 'email_in', to: 'ENG-1', kind: 'causal_chain' }]);
  });

  it('never links an artifact to itself', () => {
    expect(referencesFor(byId('ENG-1'), ids)).toEqual([]);
  });
});

describe('fixesFor', () => {
  it('reads "[TICKET-ID]" at the start of a PR title', () => {
    expect(fixesFor(byId('PR-1'), types)).toEqual([{ pr: 'PR-1', ticket: 'ENG-1' }]);
  });

  it('ignores non-PR artifacts', () => {
    expect(fixesFor(byId('CONF-1'), types)).toEqual([]);
  });
});
