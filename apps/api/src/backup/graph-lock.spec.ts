import type { Redis } from 'ioredis';
import { GraphLock } from './graph-lock';

/** A tiny in-memory stand-in for the Redis commands GraphLock uses. */
function fakeRedis(initial: string | null = null) {
  let value = initial;
  const redis = {
    set: jest.fn(async (_key: string, token: string) => (value === null ? ((value = token), 'OK') : null)),
    get: jest.fn(async () => value),
    eval: jest.fn(async (_script: string, _n: number, _key: string, token: string) => (value === token ? ((value = null), 1) : 0)),
    disconnect: jest.fn(),
    release: () => (value = null),
  };
  return redis;
}

const holderToken = (op: string) => JSON.stringify({ op, owner: 'worker:1', startedAt: 0, nonce: 'x' });

describe('GraphLock', () => {
  it('takes a free lock and releases only its own token', async () => {
    const redis = fakeRedis();
    const lock = new GraphLock(redis as unknown as Redis);
    const handle = await lock.acquire('seed');
    expect(handle?.holder.op).toBe('seed');
    expect(await lock.holder()).toMatchObject({ op: 'seed' });
    await lock.release(handle!);
    expect(await lock.holder()).toBeNull();
  });

  it('returns null at once while a seed or restore holds the lock, even when asked to wait', async () => {
    const lock = new GraphLock(fakeRedis(holderToken('restore')) as unknown as Redis);
    await expect(lock.acquire('seed', 60_000)).resolves.toBeNull();
  });

  it('waits out a running backup when asked to, then takes the lock', async () => {
    jest.useFakeTimers();
    try {
      const redis = fakeRedis(holderToken('backup'));
      const lock = new GraphLock(redis as unknown as Redis);
      const pending = lock.acquire('restore', 60_000);
      await jest.advanceTimersByTimeAsync(1_500);
      redis.release(); // the backup finishes
      await jest.advanceTimersByTimeAsync(1_500);
      const handle = await pending;
      expect(handle?.holder.op).toBe('restore');
      await lock.release(handle!);
    } finally {
      jest.useRealTimers();
    }
  });

  it('without waiting, a running backup means null', async () => {
    const lock = new GraphLock(fakeRedis(holderToken('backup')) as unknown as Redis);
    await expect(lock.acquire('restore')).resolves.toBeNull();
  });
});
