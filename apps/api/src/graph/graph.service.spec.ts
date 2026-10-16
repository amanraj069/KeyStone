import { assertNotTruncated, readInfoField } from './graph.service';

describe('readInfoField', () => {
  const info = '# Memory\r\nused_memory:2768528\r\nused_memory_human:2.64M\r\n';

  it('reads a field from an INFO reply', () => {
    expect(readInfoField(info, 'used_memory_human')).toBe('2.64M');
  });

  it('returns null for a missing field', () => {
    expect(readInfoField(info, 'nope')).toBeNull();
  });
});

describe('assertNotTruncated', () => {
  it('passes results below the RESULTSET_SIZE limit', () => {
    expect(() => assertNotTruncated(9999, 10000, 'MATCH (n) RETURN n')).not.toThrow();
  });

  it('fails loudly when a result reaches the limit (rows may have been dropped)', () => {
    expect(() => assertNotTruncated(10000, 10000, 'MATCH (n) RETURN n')).toThrow(/RESULTSET_SIZE/);
  });

  it('does nothing when the limit is unknown', () => {
    expect(() => assertNotTruncated(50000, null, 'MATCH (n) RETURN n')).not.toThrow();
  });
});
