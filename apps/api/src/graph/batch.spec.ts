import { toBatches } from './batch';

describe('toBatches', () => {
  it('splits 1,200 rows into 500 + 500 + 200', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => i);
    expect(toBatches(rows, 500).map((batch) => batch.length)).toEqual([500, 500, 200]);
  });

  it('returns no batches for no rows', () => {
    expect(toBatches([], 500)).toEqual([]);
  });

  it('rejects a non-positive batch size', () => {
    expect(() => toBatches([1], 0)).toThrow(/positive integer/);
  });
});
