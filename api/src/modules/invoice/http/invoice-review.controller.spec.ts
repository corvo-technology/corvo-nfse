import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import type { PortalReachabilityStore } from '@/modules/portal-reachability/reachability.store';
import type { FiscalPortalBreaker } from '../application/fiscal-portal-breaker';
import type { InvoiceReviewService } from '../application/invoice-review.service';
import { InvoiceReviewController } from './invoice-review.controller';

describe('GET /fiscal-portal/status', () => {
  const breaker = {
    status: jest.fn().mockResolvedValue({
      environment: 'live',
      available: true,
      since: null,
      retryAt: null,
    }),
  };
  const request = {
    authContext: { environment: 'live', apiKeyEnvironment: 'live' },
  } as unknown as RequestWithAuthContext;
  const build = (reachability: Partial<PortalReachabilityStore>) =>
    new InvoiceReviewController(
      {} as InvoiceReviewService,
      breaker as unknown as FiscalPortalBreaker,
      reachability as PortalReachabilityStore,
    );

  it('adds what the connection tests see to the breaker status', async () => {
    const connection = {
      state: 'gov_unreachable_from_us',
      since: '2026-11-26T15:00:00.000Z',
      ourSide: true,
    };
    const controller = build({ current: async () => connection } as never);
    const answer = await controller.portalStatus(request);
    expect(answer).toEqual({
      data: expect.objectContaining({ available: true, connection }),
    });
  });

  it('still answers when the connection state cannot be read', async () => {
    const controller = build({
      current: async () => {
        throw new Error('redis down');
      },
    });
    const answer = await controller.portalStatus(request);
    expect(answer).toEqual({
      data: expect.objectContaining({
        available: true,
        connection: { state: 'ok', since: null, ourSide: false },
      }),
    });
  });
});
