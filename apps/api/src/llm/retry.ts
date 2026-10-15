/** Delay before retry `attempt` (0-based): 1 s, 2 s, 4 s, 8 s ... capped at 30 s, plus up to 250 ms jitter. */
export function llmBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}

/**
 * Errors worth retrying: rate limits and quota (429, RESOURCE_EXHAUSTED),
 * server errors (5xx), timeouts and dropped connections. Bad requests and bad
 * keys (400/401/403) are not retried; they will not fix themselves.
 */
export function isTransientLlmError(error: unknown): boolean {
  const e = error as { status?: number; code?: number | string; message?: string };
  const status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined;
  if (status !== undefined && [408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  if (typeof e?.code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(e.code)) {
    return true;
  }
  return /rate limit|quota|RESOURCE_EXHAUSTED|overloaded|timed? ?out|socket hang up|UNAVAILABLE/i.test(e?.message ?? '');
}

/** Calls `work`, retrying transient errors with exponential backoff (attempts = total tries). */
export async function withBackoff<T>(
  work: () => Promise<T>,
  attempts: number,
  onRetry: (attempt: number, delayMs: number, error: unknown) => void = () => undefined,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt + 1 >= attempts || !isTransientLlmError(error)) throw error;
      const delay = llmBackoffMs(attempt);
      onRetry(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
}
