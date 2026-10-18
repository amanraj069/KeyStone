import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { sleep } from '../graph/backoff';
import { GRAPH_LOCK_KEY, GRAPH_LOCK_REDIS, GRAPH_LOCK_TTL_MS, LOCK_POLL_MS } from './backup.constants';

/** What holds the lock. "seed" and "restore" make GET /health report "seeding". */
export type GraphOperation = 'seed' | 'restore' | 'backup';

const LockHolderSchema = z.object({
  op: z.enum(['seed', 'restore', 'backup']),
  owner: z.string(),
  startedAt: z.number(),
});
export type LockHolder = z.infer<typeof LockHolderSchema>;

/** Returned by acquire; pass it to release. */
export interface LockHandle {
  holder: LockHolder;
  /** The exact value stored in Redis, so we only ever renew or delete our own lock. */
  token: string;
  renewTimer: NodeJS.Timeout;
}

/** Deletes the key only if it still holds our token (another process may own it by now). */
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Pushes the expiry back only if the key still holds our token. */
const RENEW_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

/**
 * A lock in Redis (the BullMQ Redis) around operations that replace a whole graph:
 * seed, restore and backup. The API, the worker and `pnpm seed` run in different
 * processes, so an in-memory flag would not do. The lock expires on its own if its
 * holder dies; while the holder is alive it renews the lock every TTL / 3.
 */
@Injectable()
export class GraphLock implements OnModuleDestroy {
  private readonly logger = new Logger(GraphLock.name);

  constructor(@Inject(GRAPH_LOCK_REDIS) private readonly redis: Redis) {}

  /**
   * Takes the lock for `op`, or returns null if someone else holds it. With
   * waitForBackupMs, a backup holding the lock is waited out (it takes seconds): the
   * worker's first backup runs the moment it starts, at the same time as the API's
   * startup restore or seed, which must not give up because of it.
   */
  async acquire(op: GraphOperation, waitForBackupMs = 0): Promise<LockHandle | null> {
    const holder: LockHolder = { op, owner: `${hostname()}:${process.pid}`, startedAt: Date.now() };
    const token = JSON.stringify({ ...holder, nonce: randomBytes(6).toString('hex') });
    const deadline = Date.now() + waitForBackupMs;
    while ((await this.redis.set(GRAPH_LOCK_KEY, token, 'PX', GRAPH_LOCK_TTL_MS, 'NX')) !== 'OK') {
      const current = await this.holder();
      // current === null: it was released between our SET and GET, so try again at once.
      if (current && (current.op !== 'backup' || Date.now() >= deadline)) return null;
      if (current) await sleep(LOCK_POLL_MS);
    }

    const renewTimer = setInterval(() => {
      this.redis
        .eval(RENEW_SCRIPT, 1, GRAPH_LOCK_KEY, token, String(GRAPH_LOCK_TTL_MS))
        .then((renewed) => {
          if (renewed !== 1) this.logger.warn(`Lost the graph lock for "${op}" (it expired or was taken over)`);
        })
        .catch((error: unknown) => this.logger.warn(`Could not renew the graph lock: ${String(error)}`));
    }, GRAPH_LOCK_TTL_MS / 3);
    // A pending renewal must not keep a finished CLI process alive.
    renewTimer.unref();
    return { holder, token, renewTimer };
  }

  /** Gives the lock back (only if we still hold it). */
  async release(handle: LockHandle): Promise<void> {
    clearInterval(handle.renewTimer);
    await this.redis.eval(RELEASE_SCRIPT, 1, GRAPH_LOCK_KEY, handle.token);
  }

  /** Who holds the lock right now, or null if nobody does. */
  async holder(): Promise<LockHolder | null> {
    const raw = await this.redis.get(GRAPH_LOCK_KEY);
    if (raw === null) return null;
    try {
      return LockHolderSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
