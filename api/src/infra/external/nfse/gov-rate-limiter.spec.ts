import { HttpStatusError, NetworkError } from 'open-nfse';
import { PortalUnavailableError } from '@/modules/invoice/application/fiscal-portal-breaker';
import { GovRateLimiter } from './gov-rate-limiter';

type FakeRedis = { eval: jest.Mock; set: jest.Mock };

function build(settings?: {
  perSecond?: number;
  burst?: number;
  maxWaitMs?: number;
}) {
  const redis: FakeRedis = { eval: jest.fn(), set: jest.fn() };
  const config = {
    get: () => ({ perSecond: 5, burst: 10, maxWaitMs: 300, ...settings }),
  };
  const limiter = new GovRateLimiter(redis as never, config as never);
  return { limiter, redis };
}

describe('GovRateLimiter (Redis answers)', () => {
  it('lets the call through when a token is granted', async () => {
    const { limiter, redis } = build();
    redis.eval.mockResolvedValue([1, 0]);
    await expect(limiter.acquire('sefin:production')).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'gov:bucket:sefin:production',
      'gov:pause:sefin:production',
      5,
      10,
    );
  });

  it('waits for the next token and then goes on', async () => {
    const { limiter, redis } = build({ maxWaitMs: 5_000 });
    redis.eval
      .mockResolvedValueOnce([0, 50])
      .mockResolvedValueOnce([0, 50])
      .mockResolvedValueOnce([1, 0]);
    await limiter.acquire('adn:production');
    expect(redis.eval).toHaveBeenCalledTimes(3);
  });

  it('gives the job back, not counted as an outage, when no token comes in time', async () => {
    const { limiter, redis } = build();
    redis.eval.mockResolvedValue([0, 5_000]);
    const error = await limiter
      .acquire('sefin:production')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PortalUnavailableError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as PortalUnavailableError).retryAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while tokens keep being refused, until the time is up', async () => {
    const { limiter, redis } = build();
    redis.eval.mockResolvedValue([0, 100]);
    await expect(limiter.acquire('x')).rejects.toBeInstanceOf(
      PortalUnavailableError,
    );
    expect(redis.eval.mock.calls.length).toBeGreaterThan(1);
  });

  it('hands the job back until the end of a pause set by the portal', async () => {
    const { limiter, redis } = build();
    redis.eval.mockResolvedValue([2, 20_000]);
    const before = Date.now();
    const error = (await limiter
      .acquire('sefin:production')
      .catch((e: unknown) => e)) as PortalUnavailableError;
    expect(error).toBeInstanceOf(PortalUnavailableError);
    expect(error.retryAt.getTime()).toBeGreaterThanOrEqual(before + 20_000);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('fails open when Redis is down and logs once', async () => {
    const { limiter, redis } = build();
    const warn = jest
      .spyOn(
        (limiter as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
    await limiter.acquire('sefin:production');
    await limiter.acquire('sefin:production');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('pauses the host for the Retry-After of a 429', async () => {
    const { limiter, redis } = build();
    await limiter.noteError(
      'sefin:production',
      new HttpStatusError(429, undefined, { headers: { 'retry-after': '12' } }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'gov:pause:sefin:production',
      expect.any(String),
      'PX',
      12_000,
    );
  });

  it('pauses 30 seconds on a 429 without Retry-After', async () => {
    const { limiter, redis } = build();
    await limiter.noteError('adn:production', new HttpStatusError(429, ''));
    expect(redis.set).toHaveBeenCalledWith(
      'gov:pause:adn:production',
      expect.any(String),
      'PX',
      30_000,
    );
  });

  it('pauses on a 503 only when it says Retry-After, and caps the pause', async () => {
    const { limiter, redis } = build();
    await limiter.noteError('h', new HttpStatusError(503, ''));
    expect(redis.set).not.toHaveBeenCalled();
    await limiter.noteError(
      'h',
      new HttpStatusError(503, '', { headers: { 'retry-after': '99999' } }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'gov:pause:h',
      expect.any(String),
      'PX',
      600_000,
    );
  });

  it('ignores other errors', async () => {
    const { limiter, redis } = build();
    await limiter.noteError('h', new HttpStatusError(500, ''));
    await limiter.noteError('h', new Error('boom'));
    expect(redis.set).not.toHaveBeenCalled();
  });
});
