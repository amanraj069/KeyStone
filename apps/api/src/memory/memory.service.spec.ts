import { MAX_SUMMARY_CHARS } from './memory.constants';
import { nameTerms, subjectsFromToolCalls, summarize } from './memory.service';

describe('memory helpers', () => {
  it('nameTerms gives lower-cased words and runs of up to four words', () => {
    const terms = nameTerms("Who covers Priya's React admin portal and auth-service?");
    expect(terms).toEqual(expect.arrayContaining(['priya', 'react admin portal', 'auth-service', 'who covers priya s']));
    expect(terms).not.toContain('who covers priya s react');
    expect(nameTerms('')).toEqual([]);
  });

  it('nameTerms drops trailing punctuation inside tokens', () => {
    expect(nameTerms('Ask Jax. Then TitanDB.')).toEqual(expect.arrayContaining(['jax', 'titandb', 'ask jax']));
  });

  it('subjectsFromToolCalls reads system, person, people and eventPeople arguments', () => {
    const subjects = subjectsFromToolCalls([
      { args: { system: 'TitanDB' } },
      { args: { person: 'Priya' } },
      { args: { people: ['Jax', 'Priya'], description: 'incident' } },
      { args: { person: 'Nadia', eventPeople: ['Tom'] } },
      { args: { system: 42 } },
    ]);
    expect(subjects).toEqual({ systems: ['TitanDB'], people: ['Priya', 'Jax', 'Nadia', 'Tom'] });
  });

  it('summarize keeps short answers and cuts long ones at a sentence end', () => {
    expect(summarize('  Short answer [A-1].  ')).toBe('Short answer [A-1].');
    const long = `${'First sentence is here. '.repeat(40)}`;
    const cut = summarize(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS + 1);
    expect(cut.endsWith('.…')).toBe(true);
  });
});
