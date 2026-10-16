import { record, MINI_RECORDS } from '../../test/ingest-records';
import { calendarFrom } from './calendar';
import { departuresIn } from './departures';
import { buildRoster } from './roster';

describe('departuresIn', () => {
  const roster = buildRoster(MINI_RECORDS); // employees: Ada, Bo, Cy
  const calendar = calendarFrom({
    lastDay: 4,
    days: [
      { day: 1, date: '2026-01-01' },
      { day: 2, date: '2026-01-02' },
      { day: 3, date: '2026-01-05' },
      { day: 4, date: '2026-01-06' },
    ],
  });
  const thread = (body: string, day = 2) => record({ doc_id: 'slack_hr_ops_x', doc_type: 'slack', day, actors: ['Ada'], body });

  it('reads an announced last day through the calendar', () => {
    expect(departuresIn(thread("Ada: Bo's last day is 2026-01-05. Please collect the laptop."), roster, calendar)).toEqual([
      { person: 'Bo', artifactId: 'slack_hr_ops_x', departedDay: 3 },
    ]);
  });

  it('uses the document day when no date is given', () => {
    expect(departuresIn(thread('Ada: Cy is leaving the company, farewell to Cy!'), roster, calendar)).toEqual([
      { person: 'Cy', artifactId: 'slack_hr_ops_x', departedDay: 2 },
    ]);
    expect(departuresIn(thread('Ada: Bo has resigned.'), roster, calendar)[0].departedDay).toBe(2);
  });

  it('a date after the simulated period means still here at the end', () => {
    expect(departuresIn(thread("Ada: Bo's last day will be 2026-06-30."), roster, calendar)[0].departedDay).toBe(5);
  });

  it('ignores non-employees and generic wording that names nobody leaving', () => {
    expect(departuresIn(thread("Ada: Nora's last day is 2026-01-05."), roster, calendar)).toEqual([]);
    expect(departuresIn(thread("Ada: cost for the last day of last month; handover notes; notice period 30 days"), roster, calendar)).toEqual([]);
  });

  it('skips undated documents', () => {
    expect(departuresIn(record({ doc_id: 'p', doc_type: 'confluence', day: null, actors: [], body: 'Bo has resigned.' }), roster, calendar)).toEqual([]);
  });
});
