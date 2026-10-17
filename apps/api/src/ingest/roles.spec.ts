import { rolesFor, visibilityFor } from './roles';
import { buildRoster } from './roster';
import { MINI_RECORDS, record } from '../../test/ingest-records';

describe('rolesFor', () => {
  const roster = buildRoster(MINI_RECORDS);
  const rolesOf = (id: string) =>
    rolesFor(MINI_RECORDS.find((r) => r.doc_id === id)!, roster).map((r) => `${r.rel}:${r.person}`);

  it('slack with several speakers: every employee speaker PARTICIPATED; bots and mentioned people do not', () => {
    expect(rolesOf('slack_product_2026-01-02T09:00:00')).toEqual(['PARTICIPATED:Bo', 'PARTICIPATED:Cy']);
  });

  it('slack with a single writer: that person AUTHORED it', () => {
    expect(rolesOf('slack_product_2026-01-05T09:00:00')).toEqual(['AUTHORED:Cy']);
  });

  it('zoom: every speaker PARTICIPATED, even a meeting with one speaker', () => {
    expect(rolesOf('zoom_1')).toEqual(['PARTICIPATED:Bo', 'PARTICIPATED:Ada']);
    expect(rolesOf('zoom_2')).toEqual(['PARTICIPATED:Bo']);
  });

  it('PARTICIPATED carries the number of messages the person wrote', () => {
    const thread = record({
      doc_id: 'slack_x',
      doc_type: 'slack',
      day: 5,
      actors: ['Bo', 'Cy'],
      body: 'Bo: one\nBo: two\n  more of two\nCy: three\nBo: four\nBo: five',
    });
    expect(rolesFor(thread, roster).map((r) => [r.rel, r.person, r.messages, r.wrote])).toEqual([
      ['PARTICIPATED', 'Bo', 4, true],
      ['PARTICIPATED', 'Cy', 1, true],
    ]);
  });

  it('people only listed on a conversation with no speaker lines did not write (wrote false)', () => {
    const silent = record({ doc_id: 'slack_y', doc_type: 'slack', day: 6, actors: ['Bo', 'Cy'], body: 'An alert fired at 09:00.' });
    expect(rolesFor(silent, roster).map((r) => [r.rel, r.person, r.messages, r.wrote])).toEqual([
      ['PARTICIPATED', 'Bo', 1, false],
      ['PARTICIPATED', 'Cy', 1, false],
    ]);
  });

  it('confluence: the **Author:** line wins over the actors list', () => {
    expect(rolesOf('CONF-1')).toEqual(['AUTHORED:Ada']);
  });

  it('pr: author and reviewer', () => {
    expect(rolesOf('PR-1')).toEqual(['AUTHORED:Ada', 'REVIEWED:Bo']);
  });

  it('sprint jira: owners are ASSIGNED with the ticket status', () => {
    const [role] = rolesFor(MINI_RECORDS[0], roster);
    expect(role).toEqual({ rel: 'ASSIGNED', person: 'Ada', artifactId: 'ENG-1', day: 1, status: 'To Do', messages: null, wrote: null });
  });

  it('email: only an employee sender gets an edge', () => {
    expect(rolesOf('email_in')).toEqual([]);
    expect(rolesOf('email_out')).toEqual(['AUTHORED:Ada']);
  });

  it('alerts involve no people', () => {
    expect(rolesOf('DD-1')).toEqual([]);
  });
});

describe('visibilityFor (RECEIVED, LISTED_ON)', () => {
  const roster = buildRoster(MINI_RECORDS);
  const seenOf = (id: string) => {
    const rec = MINI_RECORDS.find((r) => r.doc_id === id)!;
    return visibilityFor(rec, roster, rolesFor(rec, roster)).map((r) => `${r.rel}:${r.person}`);
  };

  it('email: an employee recipient RECEIVED it; a non-employee recipient gets nothing', () => {
    expect(seenOf('email_in')).toEqual(['RECEIVED:Ada']);
    expect(seenOf('email_out')).toEqual([]);
  });

  it("the liaison receives an email too, but never twice and never the sender", () => {
    const routed = record({
      doc_id: 'email_routed', doc_type: 'email', day: 5, actors: ['Nora', 'Bo'],
      facts: { from_addr: 'Nora <nora@vendor.example>', to_addr: 'Bo <bo@apex.example>', liaison: 'Cy' },
    });
    expect(visibilityFor(routed, roster, rolesFor(routed, roster)).map((r) => `${r.rel}:${r.person}`)).toEqual(['RECEIVED:Bo', 'RECEIVED:Cy']);
  });

  it('slack: an employee the thread lists but who did not write is LISTED_ON; speakers and bots get nothing more', () => {
    expect(seenOf('slack_product_2026-01-02T09:00:00')).toEqual(['LISTED_ON:Ada']);
    expect(seenOf('slack_product_2026-01-05T09:00:00')).toEqual([]);
  });

  it('carries the artifact day', () => {
    const rec = MINI_RECORDS.find((r) => r.doc_id === 'email_in')!;
    expect(visibilityFor(rec, roster, rolesFor(rec, roster))[0]).toMatchObject({ artifactId: 'email_in', day: 3 });
  });
});
