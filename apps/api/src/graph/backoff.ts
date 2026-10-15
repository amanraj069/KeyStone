import { BACKOFF_BASE_MS, BACKOFF_MAX_MS } from './graph.constants';

/**
 * Exponential backoff: attempt 0 waits BASE, attempt 1 waits 2*BASE, and so on,
 * never more than MAX. Used both for the first connection and for reconnects.
 */
export function backoffDelay(attempt: number, baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
