import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema';
import { backoffDelay } from '../graph/backoff';

/**
 * Connection to the separate Redis 7 container that BullMQ will use.
 * FalkorDB is never used for queues. For now this only powers /health.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      // Fail fast while disconnected instead of queueing commands forever.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => backoffDelay(attempt),
    });
    // Without an 'error' listener ioredis prints noisy unhandled-error warnings.
    this.client.on('error', (error) => this.logger.warn(`Redis error: ${error.message || error.name}`));
  }

  /** True if Redis answers PING with PONG. */
  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
