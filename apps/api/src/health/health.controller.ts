import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, MemoryReport, ServiceStatus } from '@keystone/shared';
import { HEALTH_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { HEALTH_PING } from '../graph/queries/graph.queries';
import { RedisService } from '../redis/redis.service';
import { withTimeout } from './with-timeout';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * GET /health always answers 200 with the status of each dependency,
 * so the web app can render a pill per service even when one is down.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly graph: GraphService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [falkordb, redis] = await Promise.all([this.checkFalkor(), this.checkRedis()]);
    const memory = falkordb === 'up' ? await this.readMemory() : null;
    return { falkordb, redis, memory };
  }

  /** "up" only if FalkorDB executes Cypher and returns the expected row. */
  private async checkFalkor(): Promise<ServiceStatus> {
    try {
      const rows = await withTimeout(this.graph.query<{ ok: number }>(HEALTH_GRAPH, HEALTH_PING), CHECK_TIMEOUT_MS);
      return rows[0]?.ok === 1 ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      return (await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS)) ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  /** Memory is nice to have; a failure here must not mark FalkorDB as down. */
  private async readMemory(): Promise<MemoryReport | null> {
    try {
      return await withTimeout(this.graph.memoryReport(), CHECK_TIMEOUT_MS);
    } catch {
      return null;
    }
  }
}
