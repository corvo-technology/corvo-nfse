import { DelayedError, type Job } from 'bullmq';
import { PortalUnavailableError } from '../application/fiscal-portal-breaker';

/**
 * Runs a fiscal job; while the portal is paused the job goes back to the delayed set until the
 * breaker allows the next trial. BullMQ does not count this as an attempt, so a long outage
 * never exhausts the emission or reconciliation retries.
 */
export async function runOrWaitForPortal(
  job: Job,
  token: string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error: unknown) {
    if (!(error instanceof PortalUnavailableError) || !token) throw error;
    await job.moveToDelayed(error.retryAt.getTime(), token);
    throw new DelayedError();
  }
}
