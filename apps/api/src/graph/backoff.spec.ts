import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('doubles each attempt', () => {
    expect([0, 1, 2, 3].map((attempt) => backoffDelay(attempt, 100, 10_000))).toEqual([100, 200, 400, 800]);
  });

  it('never exceeds the cap', () => {
    expect(backoffDelay(50, 100, 10_000)).toBe(10_000);
  });
});
