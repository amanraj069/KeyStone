import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, MemoryReport, ServiceStatus } from '@keystone/shared';
import { APEX_GRAPH, HEALTH_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { HEALTH_PING } from '../graph/queries/graph.queries';
import { RedisService } from '../redis/redis.service';
import { SeedService } from '../seed/seed.service';
import { withTimeout } from './with-timeout';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * GET /health always answers 200 with the status of each dependency,
 * so the web app can render a pill per service even when one is down.
 * `status` sums it up for uptime monitors and scripts/deploy.sh:
 * "up", "seeding" (apex is being restored or rebuilt, or a graph copy briefly blocks FalkorDB),
 * "degraded" (apex is empty) or "down".
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly graph: GraphService,
    private readonly redis: RedisService,
    private readonly seed: SeedService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [falkordb, redis] = await Promise.all([this.checkFalkor(), this.checkRedis()]);
    const memory = falkordb === 'up' ? await this.readMemory() : null;
    if (falkordb === 'down' || redis === 'down') {
      // GRAPH.COPY (backup, restore, the seed's final swap) blocks FalkorDB for a few
      // seconds; while one holds the graph lock that is maintenance, not an outage.
      const busy = redis === 'up' && (await this.graphOperationRunning());
      return { status: busy ? 'seeding' : 'down', falkordb, redis, memory, graph: { name: APEX_GRAPH, people: null }, seed: null };
    }
    try {
      return { falkordb, redis, memory, ...(await withTimeout(this.seed.readiness(), CHECK_TIMEOUT_MS)) };
    } catch {
      return { status: 'degraded', falkordb, redis, memory, graph: { name: APEX_GRAPH, people: null }, seed: null };
    }
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

  private async graphOperationRunning(): Promise<boolean> {
    try {
      return (await withTimeout(this.seed.graphOperation(), CHECK_TIMEOUT_MS)) !== null;
    } catch {
      return false;
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
