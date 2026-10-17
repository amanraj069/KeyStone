import { matchNames, matchWithoutLlm, prf, scoreMatches, systemKey } from './name-match';

// Test names are made up: none come from the answer key.
const ALIASES = { 'Titan DB': 'TitanDB', 'Payments-svc': 'Payments service' };

describe('name matching', () => {
  it('normalises case, punctuation and aliases', () => {
    expect(systemKey('Ledger‑Sync.', ALIASES)).toBe('ledgersync');
    expect(systemKey('Titan DB', ALIASES)).toBe(systemKey('titandb', ALIASES));
    expect(matchWithoutLlm('payments-svc', 'Payments Service', ALIASES)).toBe('exact');
  });

  it('matches close spellings and contained names as fuzzy, not unrelated ones', () => {
    expect(matchWithoutLlm('ledger-sync', 'Ledger Synk', ALIASES)).toBe('fuzzy');
    expect(matchWithoutLlm('ledger sync', 'Legacy Ledger Sync', ALIASES)).toBe('fuzzy');
    expect(matchWithoutLlm('api', 'Billing API', ALIASES)).toBeNull();
    expect(matchWithoutLlm('Ledger', 'Kafka', ALIASES)).toBeNull();
  });

  it('leaves pairs for the LLM only where a side is still unmatched', () => {
    const { matches, leftovers } = matchNames(['ledger-sync', 'billing flow'], ['Ledger Sync', 'Kafka'], ALIASES);
    expect(matches).toEqual([{ gold: 'ledger-sync', predicted: 'Ledger Sync', via: 'exact' }]);
    expect(leftovers).toEqual([
      { gold: 'ledger-sync', predicted: 'Kafka' },
      { gold: 'billing flow', predicted: 'Ledger Sync' },
      { gold: 'billing flow', predicted: 'Kafka' },
    ]);
  });

  it('scores precision on predicted names and recall on gold names', () => {
    const score = scoreMatches(['a', 'b', 'c'], ['x', 'y'], [{ gold: 'a', predicted: 'x', via: 'exact' }]);
    expect(score).toMatchObject({ tp: 1, fp: 1, fn: 2, precision: 0.5 });
    expect(score.recall).toBeCloseTo(1 / 3);
    expect(score.f1).toBeCloseTo(0.4);
  });

  it('undefined ratios are null; zero recall gives F1 0', () => {
    expect(prf(0, 0, 3)).toEqual({ tp: 0, fp: 0, fn: 3, precision: null, recall: 0, f1: null });
    expect(prf(0, 2, 3)).toEqual({ tp: 0, fp: 2, fn: 3, precision: 0, recall: 0, f1: 0 });
  });
});
