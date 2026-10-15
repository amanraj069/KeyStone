import type { MemoryReport } from '@keystone/shared';
import { GraphService, MemoryBudgetExceededError } from './graph.service';

describe('GraphService.assertMemoryBudget', () => {
  function serviceUsing(usedMemoryMb: number | null) {
    const service = new GraphService({ host: 'x', port: 1, password: 'p', memoryWarnMb: 3000, memoryMaxMb: 3600 });
    const report: MemoryReport = { usedMemoryHuman: 'n/a', usedMemoryMb, graphs: [] };
    jest.spyOn(service, 'memoryReport').mockResolvedValue(report);
    const warn = jest.spyOn((service as unknown as { logger: { warn: () => void } }).logger, 'warn');
    return { service, warn };
  }

  it('passes quietly under the warning level', async () => {
    const { service, warn } = serviceUsing(1200);
    await expect(service.assertMemoryBudget('seed')).resolves.toMatchObject({ usedMemoryMb: 1200 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns above MEMORY_WARN_MB', async () => {
    const { service, warn } = serviceUsing(3100);
    await service.assertMemoryBudget('seed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MEMORY_WARN_MB'));
  });

  it('throws above MEMORY_MAX_MB', async () => {
    const { service } = serviceUsing(3700);
    await expect(service.assertMemoryBudget('seed')).rejects.toBeInstanceOf(MemoryBudgetExceededError);
  });
});
