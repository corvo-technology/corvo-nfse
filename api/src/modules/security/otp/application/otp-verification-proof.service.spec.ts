import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { OtpVerificationProofService } from './otp-verification-proof.service';

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('OtpVerificationProofService Redis integration', () => {
  let redis: Redis;
  let service: OtpVerificationProofService;
  let keyPrefix: string;
  const scope = {
    audience: 'public' as const,
    productKey: 'greenbarber',
    channel: 'email' as const,
    purpose: 'email_verification' as const,
    subjectId: 'subject',
    target: 'test@example.com',
  };

  beforeAll(async () => {
    redis = new Redis(redisUrl!, {
      connectTimeout: 1_000,
      maxRetriesPerRequest: 0,
    });
    await redis.ping();
  });

  beforeEach(() => {
    keyPrefix = `greenflow:test:otp-proof:${randomUUID()}`;
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'redis'
          ? { keyPrefix }
          : {
              hmacSecret: 'test-otp-hmac-secret-at-least-32-characters',
              proofTtlSeconds: 300,
            },
      ),
    } as unknown as ConfigService;
    service = new OtpVerificationProofService(redis, config);
  });

  afterEach(async () => {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${keyPrefix}:otp:*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length) await redis.unlink(...keys);
    } while (cursor !== '0');
  });

  afterAll(async () => redis.quit());

  it('stores only the token hash and consumes a matching proof once', async () => {
    const created = await service.create(scope);
    const keys = await redis.keys(`${keyPrefix}:otp:proof:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(created.token);

    await expect(service.consume(created.token, scope)).resolves.not.toBeNull();
    await expect(service.consume(created.token, scope)).resolves.toBeNull();
  });

  it('consumes and rejects a proof with a different binding', async () => {
    const created = await service.create(scope);
    await expect(
      service.consume(created.token, { ...scope, purpose: 'account_recovery' }),
    ).resolves.toBeNull();
    await expect(service.consume(created.token, scope)).resolves.toBeNull();
  });
});
