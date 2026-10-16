/** Lets at most `max` tasks run at once; the others wait in order. */
export class Semaphore {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error(`Semaphore needs max >= 1, got ${max}`);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  get active(): number {
    return this.running;
  }
}

/**
 * One task per key at a time: a second call for a key that is already running
 * gets the same promise instead of starting a duplicate (two simulations of the
 * same person would only waste a scratch graph).
 */
export class KeyedLock<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = task().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
