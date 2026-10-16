import { Logger } from '@nestjs/common';
import { closeWithin } from './close-within';

describe('closeWithin', () => {
  const logger = new Logger('test');
  beforeEach(() => jest.spyOn(logger, 'warn').mockImplementation(() => undefined));

  it('returns as soon as the step closes', async () => {
    await closeWithin('fast', logger, async () => undefined, 1000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives up on a step that never finishes', async () => {
    const started = Date.now();
    await closeWithin('stuck', logger, () => new Promise(() => undefined), 50);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not close within 50 ms'));
  });

  it('logs instead of throwing when a step fails', async () => {
    await expect(closeWithin('broken', logger, async () => Promise.reject(new Error('boom')), 50)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
