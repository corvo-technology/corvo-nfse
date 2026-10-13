import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisOtpChallengeStore } from './redis-otp-challenge.store';
import type { StoredOtpChallenge } from '../domain/otp.types';

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('RedisOtpChallengeStore integration', () => {
  let redis: Redis;
  let store: RedisOtpChallengeStore;
  let keyPrefix: string;

  beforeAll(async () => {
    redis = new Redis(redisUrl!, {
      connectTimeout: 1_000,
      maxRetriesPerRequest: 0,
    });
    await redis.ping();
  });

  beforeEach(() => {
    keyPrefix = `greenflow:test:otp:${randomUUID()}`;
    const config = {
      getOrThrow: jest.fn().mockReturnValue({ keyPrefix }),
    } as unknown as ConfigService;
    store = new RedisOtpChallengeStore(redis, config);
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

  afterAll(async () => {
    await redis.quit();
  });

  const challenge = (overrides: Partial<StoredOtpChallenge> = {}) => {
    const now = Date.now();
    return {
      challengeId: randomUUID(),
      version: 1 as const,
      audience: 'public' as const,
      productHash: '1'.repeat(64),
      channel: 'email' as const,
      purpose: 'email_verification' as const,
      subjectHash: '2'.repeat(64),
      targetHash: '3'.repeat(64),
      contextHash: '4'.repeat(64),
      scopeHash: '5'.repeat(64),
      codeHash: '6'.repeat(64),
      attempts: 0,
      createdAt: now,
      expiresAt: now + 300_000,
      ...overrides,
    } satisfies StoredOtpChallenge;
  };

  const issue = (value: StoredOtpChallenge) =>
    store.issueAtomically({
      challenge: value,
      cooldownSeconds: 0,
      windowSeconds: 900,
      channelLimit: 10,
      subjectLimit: 10,
      ipLimit: 10,
      ipHash: '7'.repeat(64),
    });

  it('atomically replaces the previous active challenge', async () => {
    const first = challenge();
    const second = challenge({ scopeHash: first.scopeHash });

    await issue(first);
    await issue(second);

    expect(await store.get(first.challengeId)).toBeNull();
    expect(await store.get(second.challengeId)).toEqual(second);
  });

  it('rejects a superseded challenge and consumes a valid active challenge once', async () => {
    const current = challenge();
    await issue(current);

    const wrongScope = await store.atomicVerifyAndConsume({
      challengeId: current.challengeId,
      expectedScopeHash: '8'.repeat(64),
      codeHash: current.codeHash,
      maxAttempts: 5,
    });
    expect(wrongScope.status).toBe('scope_mismatch');

    const valid = await store.atomicVerifyAndConsume({
      challengeId: current.challengeId,
      expectedScopeHash: current.scopeHash,
      codeHash: current.codeHash,
      maxAttempts: 5,
    });
    const repeated = await store.atomicVerifyAndConsume({
      challengeId: current.challengeId,
      expectedScopeHash: current.scopeHash,
      codeHash: current.codeHash,
      maxAttempts: 5,
    });
    expect(valid.status).toBe('verified');
    expect(repeated.status).toBe('not_found');
  });

  it('increments attempts and consumes the challenge at the configured maximum', async () => {
    const current = challenge();
    await issue(current);

    const first = await store.atomicVerifyAndConsume({
      challengeId: current.challengeId,
      expectedScopeHash: current.scopeHash,
      codeHash: '9'.repeat(64),
      maxAttempts: 2,
    });
    const second = await store.atomicVerifyAndConsume({
      challengeId: current.challengeId,
      expectedScopeHash: current.scopeHash,
      codeHash: '9'.repeat(64),
      maxAttempts: 2,
    });
    expect(first).toEqual({ status: 'invalid', attempts: 1 });
    expect(second).toEqual({ status: 'max_attempts', attempts: 2 });
    expect(await store.get(current.challengeId)).toBeNull();
  });

  it('applies cooldown and distributed limits atomically', async () => {
    const current = challenge();
    const first = await store.issueAtomically({
      challenge: current,
      cooldownSeconds: 60,
      windowSeconds: 900,
      channelLimit: 1,
      subjectLimit: 1,
      ipLimit: 1,
      ipHash: '7'.repeat(64),
    });
    const second = await store.issueAtomically({
      challenge: challenge({ scopeHash: current.scopeHash }),
      cooldownSeconds: 60,
      windowSeconds: 900,
      channelLimit: 1,
      subjectLimit: 1,
      ipLimit: 1,
      ipHash: '7'.repeat(64),
    });
    expect(first.status).toBe('issued');
    expect(second.status).toBe('cooldown');
  });
});
