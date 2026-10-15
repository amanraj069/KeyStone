import { readInfoField } from './graph.service';

describe('readInfoField', () => {
  const info = '# Memory\r\nused_memory:2768528\r\nused_memory_human:2.64M\r\n';

  it('reads a field from an INFO reply', () => {
    expect(readInfoField(info, 'used_memory_human')).toBe('2.64M');
  });

  it('returns null for a missing field', () => {
    expect(readInfoField(info, 'nope')).toBeNull();
  });
});
