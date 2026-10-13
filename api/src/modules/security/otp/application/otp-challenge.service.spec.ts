import { ConfigService } from '@nestjs/config';
import { OtpChallengeService } from './otp-challenge.service';
import type { OtpChallengeStore } from '../infra/redis-otp-challenge.store';
import {
  OtpIssueCooldownError,
  OtpIssueRateLimitError,
} from '../domain/otp-errors';

const scope = {
  audience: 'authenticated' as const,
  productKey: 'greenbarber',
  channel: 'email' as const,
  purpose: 'email_verification' as const,
  subjectId: 'user-123',
  target: 'Test@Example.com',
};

describe('OtpChallengeService', () => {
  let store: jest.Mocked<OtpChallengeStore>;
  let service: OtpChallengeService;

  beforeEach(() => {
    store = {
      issueAtomically: jest.fn().mockResolvedValue({ status: 'issued' }),
      get: jest.fn(),
      revoke: jest.fn(),
      atomicVerifyAndConsume: jest.fn(),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        hmacSecret: 'test-otp-hmac-secret-at-least-32-characters',
        ttlSeconds: 300,
        proofTtlSeconds: 300,
        maxAttempts: 5,
        resendCooldownSeconds: 60,
        issueWindowSeconds: 900,
        maxIssuesPerChannelWindow: 3,
        maxIssuesPerSubjectWindow: 5,
        maxIssuesPerIpWindow: 10,
      }),
    } as unknown as ConfigService;
    service = new OtpChallengeService(
      store,
      config,
      () => '123456',
      () => '11111111-1111-4111-8111-111111111111',
      () => 1_700_000_000_000,
    );
  });

  it('issues a normalized, masked challenge without storing raw identity fields', async () => {
    const result = await service.issue(scope);

    expect(result).toEqual(
      expect.objectContaining({
        challengeId: '11111111-1111-4111-8111-111111111111',
        code: '123456',
        normalizedTarget: 'test@example.com',
        maskedTarget: 't***@example.com',
      }),
    );
    const challenge = store.issueAtomically.mock.calls[0][0].challenge;
    expect(challenge).not.toHaveProperty('target');
    expect(challenge).not.toHaveProperty('subjectId');
    expect(JSON.stringify(challenge)).not.toContain('test@example.com');
    expect(JSON.stringify(challenge)).not.toContain('user-123');
  });

  it('surfaces cooldown and rate-limit results from the atomic store', async () => {
    store.issueAtomically.mockResolvedValueOnce({
      status: 'cooldown',
      retryAfterSeconds: 42,
    });
    await expect(service.issue(scope)).rejects.toBeInstanceOf(
      OtpIssueCooldownError,
    );

    store.issueAtomically.mockResolvedValueOnce({
      status: 'rate_limited',
      scope: 'ip',
    });
    await expect(service.issue(scope)).rejects.toBeInstanceOf(
      OtpIssueRateLimitError,
    );
  });

  it('accepts only the expected bound scope and active challenge', async () => {
    await service.issue(scope);
    const challenge = store.issueAtomically.mock.calls[0][0].challenge;
    store.get.mockResolvedValue(challenge);
    store.atomicVerifyAndConsume.mockResolvedValue({
      status: 'verified',
      attempts: 0,
    });

    const result = await service.verify({
      ...scope,
      challengeId: challenge.challengeId,
      code: '123456',
    });

    expect(result.valid).toBe(true);
    expect(store.atomicVerifyAndConsume).toHaveBeenCalledWith(
      expect.objectContaining({ expectedScopeHash: challenge.scopeHash }),
    );
  });

  it('returns the same invalid result for missing and rejected challenges', async () => {
    store.get.mockResolvedValueOnce(null);
    await expect(
      service.verify({
        ...scope,
        challengeId: crypto.randomUUID(),
        code: '123456',
      }),
    ).resolves.toEqual({ valid: false, attempts: 0, maxAttempts: 5 });

    await service.issue(scope);
    store.get.mockResolvedValueOnce(
      store.issueAtomically.mock.calls[0][0].challenge,
    );
    store.atomicVerifyAndConsume.mockResolvedValueOnce({
      status: 'scope_mismatch',
      attempts: 0,
    });
    await expect(
      service.verify({
        ...scope,
        challengeId: crypto.randomUUID(),
        code: '123456',
      }),
    ).resolves.toEqual({ valid: false, attempts: 0, maxAttempts: 5 });
  });

  it('revokes a stored challenge using its protected scope', async () => {
    await service.issue(scope);
    const challenge = store.issueAtomically.mock.calls[0][0].challenge;
    store.get.mockResolvedValue(challenge);

    await service.revoke(challenge.challengeId);

    expect(store.revoke).toHaveBeenCalledWith(
      challenge.challengeId,
      challenge.scopeHash,
    );
  });
});
