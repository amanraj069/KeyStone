import { numbersIn, watchedRiskChanges } from './actions.service';

describe('numbersIn', () => {
  it('finds every whole number in a text', () => {
    expect(numbersIn('25 tickets to Deepa (18) and Jenna (4); Go 1.21')).toEqual([25, 18, 4, 1, 21]);
    expect(numbersIn('no numbers')).toEqual([]);
  });
});

describe('watchedRiskChanges', () => {
  const change = (system: string, before: 'orphaned' | 'critical' | 'watch' | 'ok' | null, after: 'orphaned' | 'critical' | 'watch' | 'ok' | null) => ({
    system,
    before,
    after,
    expertsAfter: [],
  });

  it('keeps systems that became critical or orphaned', () => {
    const rows = watchedRiskChanges([change('A', 'watch', 'critical'), change('B', 'critical', 'orphaned'), change('C', null, 'critical')]);
    expect(rows.map((r) => r.system)).toEqual(['A', 'B', 'C']);
  });

  it('ignores systems that got safer or are not at risk', () => {
    const rows = watchedRiskChanges([change('A', 'orphaned', 'critical'), change('B', 'critical', 'watch'), change('C', 'watch', 'ok'), change('D', 'ok', null)]);
    expect(rows).toEqual([]);
  });
});
