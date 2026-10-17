import { checkerModel } from './bench.constants';

describe('checkerModel', () => {
  it('is the system model unless BENCH_JUDGE_MODEL names another', () => {
    expect(checkerModel(undefined, 'gpt-5-nano')).toBe('gpt-5-nano');
    expect(checkerModel('  ', 'gpt-5-nano')).toBe('gpt-5-nano');
    expect(checkerModel('gpt-5-mini', 'gpt-5-nano')).toBe('gpt-5-mini');
  });
});
