import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AppConfiguration, OtpConfig } from '@/infra/config/configuration';
import {
  OtpIssueCooldownError,
  OtpIssueRateLimitError,
} from '../domain/otp-errors';
import {
  computeCodeHmac,
  computeScopeHashes,
  hmacValue,
  recomputeCodeHash,
} from '../domain/otp-hmac';
import { maskOtpTarget, normalizeOtpTarget } from '../domain/otp-normalize';
import type {
  IssueOtpInput,
  IssueOtpResult,
  StoredOtpChallenge,
  VerifyOtpInput,
  VerifyOtpResult,
} from '../domain/otp.types';
import {
  OTP_CHALLENGE_STORE,
  type OtpChallengeStore,
} from '../infra/redis-otp-challenge.store';

@Injectable()
export class OtpChallengeService {
  constructor(
    @Inject(OTP_CHALLENGE_STORE)
    private readonly store: OtpChallengeStore,
    private readonly configService: ConfigService<AppConfiguration>,
    @Optional()
    private readonly generateCode: () => string = () =>
      String(randomInt(100000, 1000000)),
    @Optional()
    private readonly uuid: () => string = () => uuidv4(),
    @Optional()
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issue(input: IssueOtpInput): Promise<IssueOtpResult> {
    this.assertScope(input);
    const config = this.config();
    const normalizedTarget = normalizeOtpTarget(input.channel, input.target);
    const scope = computeScopeHashes(config.hmacSecret, {
      ...input,
      target: normalizedTarget,
    });
    const challengeId = this.uuid();
    const code = this.generateCode();
    const createdAt = this.now();
    const expiresAt = createdAt + config.ttlSeconds * 1000;
    const immutable = {
      challengeId,
      version: 1 as const,
      audience: input.audience,
      productHash: scope.productHash,
      channel: input.channel,
      purpose: input.purpose,
      subjectHash: scope.subjectHash,
      targetHash: scope.targetHash,
      contextHash: scope.contextHash,
      scopeHash: scope.scopeHash,
      createdAt,
      expiresAt,
    };
    const challenge: StoredOtpChallenge = {
      ...immutable,
      codeHash: computeCodeHmac(config.hmacSecret, immutable, code),
      attempts: 0,
    };
    const result = await this.store.issueAtomically({
      challenge,
      cooldownSeconds: config.resendCooldownSeconds,
      windowSeconds: config.issueWindowSeconds,
      channelLimit: config.maxIssuesPerChannelWindow,
      subjectLimit: config.maxIssuesPerSubjectWindow,
      ipLimit: config.maxIssuesPerIpWindow,
      ipHash: hmacValue(config.hmacSecret, {
        ip: input.requestIp?.trim() || 'unknown',
      }),
    });
    if (result.status === 'cooldown') {
      throw new OtpIssueCooldownError(
        input.channel,
        maskOtpTarget(input.channel, normalizedTarget),
        result.retryAfterSeconds,
      );
    }
    if (result.status === 'rate_limited') {
      throw new OtpIssueRateLimitError(result.scope, config.issueWindowSeconds);
    }
    return {
      challengeId,
      code,
      expiresAt,
      resendAvailableAt: createdAt + config.resendCooldownSeconds * 1000,
      channel: input.channel,
      normalizedTarget,
      maskedTarget: maskOtpTarget(input.channel, normalizedTarget),
    };
  }

  async verify(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    this.assertScope(input);
    if (!input.challengeId?.trim() || !/^\d{6}$/.test(input.code)) {
      return this.invalidResult();
    }
    const config = this.config();
    const normalizedTarget = normalizeOtpTarget(input.channel, input.target);
    const expectedScope = computeScopeHashes(config.hmacSecret, {
      ...input,
      target: normalizedTarget,
    });
    const challenge = await this.store.get(input.challengeId);
    if (!challenge) return this.invalidResult();
    const result = await this.store.atomicVerifyAndConsume({
      challengeId: input.challengeId,
      expectedScopeHash: expectedScope.scopeHash,
      codeHash: recomputeCodeHash(config.hmacSecret, challenge, input.code),
      maxAttempts: config.maxAttempts,
    });
    return {
      valid: result.status === 'verified',
      attempts: result.attempts,
      maxAttempts: config.maxAttempts,
    };
  }

  async revoke(challengeId: string): Promise<void> {
    const challenge = await this.store.get(challengeId);
    if (challenge) await this.store.revoke(challengeId, challenge.scopeHash);
  }

  private invalidResult(): VerifyOtpResult {
    return {
      valid: false,
      attempts: 0,
      maxAttempts: this.config().maxAttempts,
    };
  }

  private assertScope(input: IssueOtpInput | VerifyOtpInput): void {
    if (!input.subjectId?.trim()) throw new Error('subjectId is required');
    if (!input.productKey?.trim()) throw new Error('productKey is required');
    if (!input.target?.trim()) throw new Error('target is required');
  }

  private config(): OtpConfig {
    return this.configService.getOrThrow<OtpConfig>('otp');
  }
}
