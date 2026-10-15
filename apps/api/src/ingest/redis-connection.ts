import { Redis } from 'ioredis';

/**
 * A new ioredis connection for BullMQ. Every Queue, Worker and QueueEvents gets
 * its own (workers and event listeners block on Redis). BullMQ requires
 * maxRetriesPerRequest: null so blocking commands are never cut off.
 */
export function bullConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
