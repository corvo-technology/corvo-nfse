import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';
import { StripeWebhookRateLimitGuard } from './stripe-webhook-rate-limit.guard';

function context(ip = '1.2.3.4') {
  const setHeader = jest.fn();
  return {
    setHeader,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, ip }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext,
  };
}

describe(StripeWebhookRateLimitGuard.name, () => {
  const check = jest.fn();
  const limiter = { check } as unknown as RedisRateLimiter;

  beforeEach(() => check.mockReset());

  it('allows requests under the budget, keyed by IP, without extra headers', async () => {
    check.mockResolvedValue({
      allowed: true,
      remaining: 599,
      resetAt: Date.now() + 60000,
    });
    const { ctx, setHeader } = context();

    await expect(
      new StripeWebhookRateLimitGuard(
        limiter,
        new ConfigService({}),
      ).canActivate(ctx),
    ).resolves.toBe(true);

    expect(check).toHaveBeenCalledWith('stripe-webhook:ip:1.2.3.4', {
      max: 600,
      windowMs: 60000,
    });
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('uses the configured ceiling', async () => {
    check.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60000,
    });

    await new StripeWebhookRateLimitGuard(
      limiter,
      new ConfigService({ RATE_LIMIT_STRIPE_WEBHOOK: 10 }),
    ).canActivate(context().ctx);

    expect(check).toHaveBeenCalledWith(expect.any(String), {
      max: 10,
      windowMs: 60000,
    });
  });

  it('rejects with 429 and Retry-After when over the budget', async () => {
    check.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30000,
    });
    const { ctx, setHeader } = context();

    await expect(
      new StripeWebhookRateLimitGuard(
        limiter,
        new ConfigService({}),
      ).canActivate(ctx),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'ERROR_RATE_LIMIT_EXCEEDED' },
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
});
