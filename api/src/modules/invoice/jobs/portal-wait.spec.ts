import { DelayedError } from 'bullmq';
import { PortalUnavailableError } from '../application/fiscal-portal-breaker';
import { runOrWaitForPortal } from './portal-wait';

describe('runOrWaitForPortal', () => {
  const retryAt = new Date('2026-11-08T12:05:00Z');

  it('puts the job back to wait for the portal without spending an attempt', async () => {
    const job = { moveToDelayed: jest.fn() };
    await expect(
      runOrWaitForPortal(job as never, 'token', () =>
        Promise.reject(new PortalUnavailableError(retryAt)),
      ),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(retryAt.getTime(), 'token');
  });

  it('lets any other error fail the attempt as before', async () => {
    const job = { moveToDelayed: jest.fn() };
    await expect(
      runOrWaitForPortal(job as never, 'token', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });
});
