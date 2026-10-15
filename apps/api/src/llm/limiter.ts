/**
 * Runs at most `concurrency` async jobs at a time; the rest wait in a queue.
 * (Same idea as the p-limit package, which is ESM-only and cannot be required here.)
 */
export function createLimiter(concurrency: number): <T>(job: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Concurrency must be >= 1, got ${concurrency}`);
  let active = 0;
  const waiting: (() => void)[] = [];

  const next = () => {
    active--;
    waiting.shift()?.();
  };

  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await job();
    } finally {
      next();
    }
  };
}
