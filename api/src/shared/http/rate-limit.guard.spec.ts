import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  HttpApiRateLimitGuard,
  PreAuthRateLimitGuard,
} from './rate-limit.guard';
import { RedisRateLimiter } from './redis-rate-limiter';

function context(request: Record<string, unknown>) {
  const setHeader = jest.fn();
  const handler = function endpoint() {};
  class Controller {}
  return {
    setHeader,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/v1/invoices',
          method: 'GET',
          headers: {},
          ip: '1.2.3.4',
          ...request,
        }),
        getResponse: () => ({ setHeader }),
      }),
      getHandler: () => handler,
      getClass: () => Controller,
    } as unknown as ExecutionContext,
  };
}
describe('HTTP rate limit policies', () => {
  const check = jest.fn();
  const limiter = { check } as unknown as RedisRateLimiter;
  const config = new ConfigService({});
  beforeEach(() => {
    check.mockReset().mockResolvedValue({
      allowed: true,
      remaining: 299,
      resetAt: Date.now() + 60000,
    });
  });
  it('shares the budget by validated key ID, across routes', async () => {
    const guard = new HttpApiRateLimitGuard(limiter, new Reflector(), config);
    const first = context({ validatedApiKeyId: 'key-1' });
    await guard.canActivate(first.ctx);
    await guard.canActivate(
      context({ path: '/v1/credits', validatedApiKeyId: 'key-1' }).ctx,
    );
    expect(check).toHaveBeenNthCalledWith(1, 'authenticated:key:key-1', {
      max: 300,
      windowMs: 60000,
    });
    expect(check).toHaveBeenNthCalledWith(2, 'authenticated:key:key-1', {
      max: 300,
      windowMs: 60000,
    });
    expect(first.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 300);
  });
  it('does not trust unvalidated API key headers', async () => {
    await new HttpApiRateLimitGuard(
      limiter,
      new Reflector(),
      config,
    ).canActivate(context({ headers: { 'x-api-key': 'forged' } }).ctx);
    expect(check).toHaveBeenCalledWith('public:ip:1.2.3.4', {
      max: 120,
      windowMs: 60000,
    });
  });
  it('uses validated sessions and preserves sensitive route policies', async () => {
    const { ctx } = context({ authContext: { sessionId: 'session-1' } });
    Reflect.defineMetadata('THROTTLER:LIMITdefault', 10, ctx.getHandler());
    Reflect.defineMetadata('THROTTLER:TTLdefault', 60000, ctx.getHandler());
    await new HttpApiRateLimitGuard(
      limiter,
      new Reflector(),
      config,
    ).canActivate(ctx);
    expect(check).toHaveBeenNthCalledWith(
      1,
      'authenticated:session:session-1',
      { max: 300, windowMs: 60000 },
    );
    expect(check).toHaveBeenNthCalledWith(
      2,
      'sensitive:Controller:endpoint:ip:1.2.3.4',
      { max: 10, windowMs: 60000 },
    );
  });
  it('returns the 429 contract and retry headers', async () => {
    check.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 5000,
    });
    const { ctx, setHeader } = context({});
    await expect(
      new HttpApiRateLimitGuard(limiter, new Reflector(), config).canActivate(
        ctx,
      ),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'ERROR_RATE_LIMIT_EXCEEDED' },
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
  });
  it.each([
    { path: '/v1/health/live' },
    { path: '/v1/health/ready' },
    { path: '/v1/webhooks/stripe' },
    { method: 'OPTIONS' },
  ])('exempts %p', async (request) => {
    await new HttpApiRateLimitGuard(
      limiter,
      new Reflector(),
      config,
    ).canActivate(context(request).ctx);
    await new PreAuthRateLimitGuard(limiter, config).canActivate(
      context(request).ctx,
    );
    expect(check).not.toHaveBeenCalled();
  });
});
