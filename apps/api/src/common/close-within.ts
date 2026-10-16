import type { Logger } from '@nestjs/common';

/** How long one shutdown step may take before it is abandoned. */
export const SHUTDOWN_STEP_MS = 3000;

/**
 * Runs one shutdown step (closing a client or a queue) but never waits longer
 * than `ms`. Without this, closing a connection while its database is down
 * (e.g. Docker Desktop stopped) waits forever, the process never exits, and
 * `nest start --watch` can no longer restart the app with new code.
 */
export async function closeWithin(label: string, logger: Logger, close: () => Promise<unknown>, ms = SHUTDOWN_STEP_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    const result = await Promise.race([close().then(() => 'closed' as const), timeout]);
    if (result === 'timeout') logger.warn(`${label} did not close within ${ms} ms; continuing shutdown`);
  } catch (error) {
    logger.warn(`${label} failed to close: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
