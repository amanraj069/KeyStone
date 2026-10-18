import { SlidingWindow } from './rate-limit.guard';

describe('SlidingWindow', () => {
  it('allows up to the limit inside the window, then refuses', () => {
    const window = new SlidingWindow(2, 60_000);
    expect(window.take('a', 0)).toBe(true);
    expect(window.take('a', 1_000)).toBe(true);
    expect(window.take('a', 2_000)).toBe(false);
  });

  it('counts each key on its own', () => {
    const window = new SlidingWindow(1, 60_000);
    expect(window.take('a', 0)).toBe(true);
    expect(window.take('b', 0)).toBe(true);
    expect(window.take('a', 1)).toBe(false);
  });

  it('frees a slot once the oldest request leaves the window, and says when', () => {
    const window = new SlidingWindow(1, 60_000);
    window.take('a', 0);
    expect(window.take('a', 30_000)).toBe(false);
    expect(window.retryAfterSeconds('a', 30_000)).toBe(30);
    expect(window.take('a', 60_001)).toBe(true);
  });
});
