import { isTransientLlmError, withBackoff } from './retry';

describe('isTransientLlmError', () => {
  it.each([
    [{ status: 429 }, true],
    [{ status: 503 }, true],
    [{ code: 'ECONNRESET' }, true],
    [new Error('RESOURCE_EXHAUSTED: quota exceeded'), true],
    [{ status: 400 }, false],
    [{ status: 401 }, false],
    [new Error('Invalid API key'), false],
  ])('%p -> %p', (error, expected) => {
    expect(isTransientLlmError(error)).toBe(expected);
  });
});

describe('withBackoff', () => {
  const noSleep = async () => undefined;

  it('retries a 429 and then succeeds', async () => {
    const work = jest.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce('ok');
    await expect(withBackoff(work, 5, undefined, noSleep)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry a bad request', async () => {
    const work = jest.fn().mockRejectedValue({ status: 400 });
    await expect(withBackoff(work, 5, undefined, noSleep)).rejects.toEqual({ status: 400 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('gives up after the given number of attempts', async () => {
    const work = jest.fn().mockRejectedValue({ status: 503 });
    await expect(withBackoff(work, 3, undefined, noSleep)).rejects.toEqual({ status: 503 });
    expect(work).toHaveBeenCalledTimes(3);
  });
});
