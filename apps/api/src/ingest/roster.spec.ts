import { buildRoster, messagesBySpeaker, speakersOf } from './roster';
import { MINI_RECORDS, record } from '../../test/ingest-records';

describe('buildRoster', () => {
  const roster = buildRoster(MINI_RECORDS);

  it('finds the company domain as the one most actors share', () => {
    expect(roster.companyDomain).toBe('apex.example');
  });

  it('keeps employees and excludes vendors and bots', () => {
    expect(roster.people.map((p) => p.name)).toEqual(['Ada', 'Bo', 'Cy']);
    expect(roster.isEmployee('Nora')).toBe(false);
    expect(roster.isEmployee('GitHub')).toBe(false);
  });

  it('keeps a new hire who wrote from a personal address and then speaks in Slack', () => {
    expect(roster.isEmployee('Cy')).toBe(true);
  });

  it('assigns departments by sprint tickets, then meetings, then channels', () => {
    const dept = Object.fromEntries(roster.people.map((p) => [p.name, p.dept]));
    expect(dept).toEqual({ Ada: 'Engineering_Backend', Bo: 'Product', Cy: 'Product' });
  });
});

describe('speakersOf', () => {
  it('reads Slack "Name:" lines and ignores actors who did not speak', () => {
    const thread = record({ doc_id: 's', doc_type: 'slack', actors: ['Ann', 'Bob', 'Mentioned'], body: 'Ann: hi\nBob: yo' });
    expect(speakersOf(thread)).toEqual(['Ann', 'Bob']);
  });

  it('reads Zoom "**[time] Name:**" lines', () => {
    const meeting = record({ doc_id: 'z', doc_type: 'zoom_transcript', actors: ['Ann'], body: '**[09:00:00] Ann:** hi' });
    expect(speakersOf(meeting)).toEqual(['Ann']);
  });
});

describe('messagesBySpeaker', () => {
  it('counts one message per "Name:" line; continuation lines belong to the previous message', () => {
    const thread = record({
      doc_id: 's',
      doc_type: 'slack',
      actors: ['Ann', 'Bob'],
      body: 'Ann: plan:\n1. migrate\n2. test\nBob: ok\nAnn: done\nCarol: not an actor',
    });
    expect([...messagesBySpeaker(thread)]).toEqual([
      ['Ann', 2],
      ['Bob', 1],
    ]);
  });

  it('counts Zoom speaking turns', () => {
    const meeting = record({
      doc_id: 'z',
      doc_type: 'zoom_transcript',
      actors: ['Ann', 'Bob'],
      body: '**[09:00:00] Ann:** hi\n\n**[09:01:00] Bob:** hey\n\n**[09:02:00] Ann:** agenda',
    });
    expect([...messagesBySpeaker(meeting)]).toEqual([
      ['Ann', 2],
      ['Bob', 1],
    ]);
  });
});
