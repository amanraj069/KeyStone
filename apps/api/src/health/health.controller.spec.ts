import type { GraphService } from '../graph/graph.service';
import type { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const memory = { usedMemoryHuman: '1.00M', usedMemoryMb: 1, graphs: [] };

  function makeController(graph: Partial<GraphService>, redis: Partial<RedisService>) {
    return new HealthController(graph as GraphService, redis as RedisService);
  }

  it('reports both services up with memory', async () => {
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockResolvedValue(true) },
    );
    await expect(controller.check()).resolves.toEqual({ falkordb: 'up', redis: 'up', memory });
  });

  it('reports FalkorDB down and skips memory when the query fails', async () => {
    const memoryReport = jest.fn();
    const controller = makeController(
      { query: jest.fn().mockRejectedValue(new Error('offline')), memoryReport },
      { ping: jest.fn().mockResolvedValue(true) },
    );
    await expect(controller.check()).resolves.toEqual({ falkordb: 'down', redis: 'up', memory: null });
    expect(memoryReport).not.toHaveBeenCalled();
  });

  it('reports Redis down when PING fails', async () => {
    const controller = makeController(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]), memoryReport: jest.fn().mockResolvedValue(memory) },
      { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    );
    await expect(controller.check()).resolves.toMatchObject({ falkordb: 'up', redis: 'down' });
  });
});
