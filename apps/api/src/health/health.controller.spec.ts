import type { GraphService } from '../graph/graph.service';
import type { RedisService } from '../redis/redis.service';
import type { SeedService } from '../seed/seed.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const memory = { usedMemoryHuman: '1.00M', usedMemoryMb: 1, graphs: [] };
  const seedStatus = { state: 'idle', step: null, startedAt: null, finishedAt: null, error: null, missing: [], missingCount: 0 } as const;
  const ready = { status: 'up', graph: { name: 'apex', people: 44 }, seed: seedStatus } as const;

  function makeController(graph: Partial<GraphService>, redis: Partial<RedisService>, seed: Partial<SeedService> = {}) {
    const readiness = seed.readiness ?? jest.fn().mockResolvedValue(ready);
    const graphOperation = seed.graphOperation ?? jest.fn().mockResolvedValue(null);
    return new HealthController(graph as GraphService, redis as RedisService, { readiness, graphOperation } as unknown as SeedService);
  }

  it('reports both services up with memory, and the graph readiness', async () => {
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockResolvedValue(true) },
    );
    await expect(controller.check()).resolves.toEqual({ falkordb: 'up', redis: 'up', memory, ...ready });
  });

  it('reports "seeding" while the seed runs', async () => {
    const seeding = { ...ready, status: 'seeding', seed: { ...seedStatus, state: 'seeding', step: 'ingest' } };
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockResolvedValue(true) },
      { readiness: jest.fn().mockResolvedValue(seeding) },
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'seeding', seed: { step: 'ingest' } });
  });

  it('reports FalkorDB down (overall "down") and skips memory and readiness when the query fails', async () => {
    const memoryReport = jest.fn();
    const readiness = jest.fn();
    const controller = makeController(
      { query: jest.fn().mockRejectedValue(new Error('offline')), memoryReport },
      { ping: jest.fn().mockResolvedValue(true) },
      { readiness },
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'down', falkordb: 'down', redis: 'up', memory: null });
    expect(memoryReport).not.toHaveBeenCalled();
    expect(readiness).not.toHaveBeenCalled();
  });

  it('reports "seeding", not "down", when FalkorDB is blocked by a graph copy that holds the lock', async () => {
    const controller = makeController(
      { query: jest.fn().mockRejectedValue(new Error('Timed out after 2000 ms')), memoryReport: jest.fn() },
      { ping: jest.fn().mockResolvedValue(true) },
      { graphOperation: jest.fn().mockResolvedValue({ op: 'backup', owner: 'worker:1', startedAt: 0 }) },
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'seeding', falkordb: 'down' });
  });

  it('reports Redis down when PING fails', async () => {
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'down', falkordb: 'up', redis: 'down' });
  });

  it('reports "degraded" when readiness cannot be read', async () => {
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockResolvedValue(true) },
      { readiness: jest.fn().mockRejectedValue(new Error('boom')) },
    );
    await expect(controller.check()).resolves.toMatchObject({ status: 'degraded', graph: { people: null } });
  });
});
