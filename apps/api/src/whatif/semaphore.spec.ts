import { KeyedLock, Semaphore } from './semaphore';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('Semaphore', () => {
  it('never runs more than max tasks at once, and runs them all', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      return 'ok';
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => semaphore.run(task)));
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(peak).toBe(2);
    expect(semaphore.active).toBe(0);
  });

  it('frees the slot when a task throws', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(semaphore.run(async () => 'next')).resolves.toBe('next');
  });
});

describe('KeyedLock', () => {
  it('shares one run per key and starts a new one afterwards', async () => {
    const lock = new KeyedLock<number>();
    let calls = 0;
    const task = async () => {
      calls++;
      await tick();
      return calls;
    };
    const [a, b] = await Promise.all([lock.run('Ada', task), lock.run('Ada', task)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    await expect(lock.run('Ada', task)).resolves.toBe(2);
    await expect(lock.run('Ben', task)).resolves.toBe(3);
  });
});
