import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type {
  AppConfiguration,
  RedisConfig,
} from '@/infra/config/configuration';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { buildRedisKey } from '@/infra/redis/redis-key.util';
import type { StoredOtpChallenge } from '../domain/otp.types';

export type OtpIssueStoreResult =
  | { status: 'issued' }
  | { status: 'cooldown'; retryAfterSeconds: number }
  | { status: 'rate_limited'; scope: 'channel' | 'subject' | 'ip' };

export interface OtpChallengeStore {
  issueAtomically(input: {
    challenge: StoredOtpChallenge;
    cooldownSeconds: number;
    windowSeconds: number;
    channelLimit: number;
    subjectLimit: number;
    ipLimit: number;
    ipHash: string;
  }): Promise<OtpIssueStoreResult>;
  get(challengeId: string): Promise<StoredOtpChallenge | null>;
  revoke(challengeId: string, scopeHash: string): Promise<void>;
  atomicVerifyAndConsume(input: {
    challengeId: string;
    expectedScopeHash: string;
    codeHash: string;
    maxAttempts: number;
  }): Promise<{
    status:
      | 'verified'
      | 'invalid'
      | 'expired'
      | 'not_found'
      | 'max_attempts'
      | 'superseded'
      | 'scope_mismatch';
    attempts: number;
  }>;
}

export const OTP_CHALLENGE_STORE = Symbol('OTP_CHALLENGE_STORE');

const ISSUE_SCRIPT = `
local cooldownTtl = redis.call('TTL', KEYS[3])
if cooldownTtl > 0 then
  return cjson.encode({status='cooldown', retryAfterSeconds=cooldownTtl})
end

local function incrementWithTtl(key, window)
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, window) end
  return count
end

local channelCount = incrementWithTtl(KEYS[4], tonumber(ARGV[4]))
local subjectCount = incrementWithTtl(KEYS[5], tonumber(ARGV[4]))
local ipCount = incrementWithTtl(KEYS[6], tonumber(ARGV[4]))
if channelCount > tonumber(ARGV[5]) then
  return cjson.encode({status='rate_limited', scope='channel'})
end
if subjectCount > tonumber(ARGV[6]) then
  return cjson.encode({status='rate_limited', scope='subject'})
end
if ipCount > tonumber(ARGV[7]) then
  return cjson.encode({status='rate_limited', scope='ip'})
end

local previousId = redis.call('GET', KEYS[2])
if previousId then redis.call('DEL', ARGV[8] .. previousId) end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
redis.call('SET', KEYS[2], ARGV[3], 'PX', tonumber(ARGV[2]))
if tonumber(ARGV[9]) > 0 then
  redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[9]))
end
return cjson.encode({status='issued'})
`;

const VERIFY_SCRIPT = `
local challengeData = redis.call('GET', KEYS[1])
if not challengeData then
  return cjson.encode({status='not_found', attempts=0})
end
local challenge = cjson.decode(challengeData)
if challenge.scopeHash ~= ARGV[1] then
  return cjson.encode({status='scope_mismatch', attempts=0})
end
local activeId = redis.call('GET', KEYS[2])
if activeId ~= ARGV[2] then
  redis.call('DEL', KEYS[1])
  return cjson.encode({status='superseded', attempts=challenge.attempts})
end
local now = tonumber(ARGV[3])
if now >= challenge.expiresAt then
  redis.call('DEL', KEYS[1], KEYS[2])
  return cjson.encode({status='expired', attempts=challenge.attempts})
end
if challenge.codeHash == ARGV[4] then
  redis.call('DEL', KEYS[1], KEYS[2])
  return cjson.encode({status='verified', attempts=challenge.attempts})
end
local attempts = challenge.attempts + 1
if attempts >= tonumber(ARGV[5]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return cjson.encode({status='max_attempts', attempts=attempts})
end
challenge.attempts = attempts
redis.call('SET', KEYS[1], cjson.encode(challenge), 'PX', challenge.expiresAt - now)
return cjson.encode({status='invalid', attempts=attempts})
`;

const REVOKE_SCRIPT = `
redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('DEL', KEYS[2])
end
return 1
`;

@Injectable()
export class RedisOtpChallengeStore implements OtpChallengeStore {
  private readonly keyPrefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService<AppConfiguration>,
  ) {
    this.keyPrefix = configService.getOrThrow<RedisConfig>('redis').keyPrefix;
  }

  async issueAtomically(
    input: Parameters<OtpChallengeStore['issueAtomically']>[0],
  ): Promise<OtpIssueStoreResult> {
    const ttlMs = Math.max(1, input.challenge.expiresAt - Date.now());
    const raw = (await this.redis.eval(
      ISSUE_SCRIPT,
      6,
      this.challengeKey(input.challenge.challengeId),
      this.activeKey(input.challenge.scopeHash),
      this.cooldownKey(input.challenge.scopeHash),
      this.rateChannelKey(input.challenge.targetHash),
      this.rateSubjectKey(input.challenge.subjectHash),
      this.rateIpKey(input.ipHash),
      JSON.stringify(input.challenge),
      String(ttlMs),
      input.challenge.challengeId,
      String(input.windowSeconds),
      String(input.channelLimit),
      String(input.subjectLimit),
      String(input.ipLimit),
      this.challengeKey(''),
      String(input.cooldownSeconds),
    )) as string;
    return JSON.parse(raw) as OtpIssueStoreResult;
  }

  async get(challengeId: string): Promise<StoredOtpChallenge | null> {
    const raw = await this.redis.get(this.challengeKey(challengeId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredOtpChallenge;
  }

  async revoke(challengeId: string, scopeHash: string): Promise<void> {
    await this.redis.eval(
      REVOKE_SCRIPT,
      2,
      this.challengeKey(challengeId),
      this.activeKey(scopeHash),
      challengeId,
    );
  }

  async atomicVerifyAndConsume(
    input: Parameters<OtpChallengeStore['atomicVerifyAndConsume']>[0],
  ): ReturnType<OtpChallengeStore['atomicVerifyAndConsume']> {
    const raw = (await this.redis.eval(
      VERIFY_SCRIPT,
      2,
      this.challengeKey(input.challengeId),
      this.activeKey(input.expectedScopeHash),
      input.expectedScopeHash,
      input.challengeId,
      String(Date.now()),
      input.codeHash,
      String(input.maxAttempts),
    )) as string;
    return JSON.parse(raw) as Awaited<
      ReturnType<OtpChallengeStore['atomicVerifyAndConsume']>
    >;
  }

  private challengeKey(id: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `challenge:${id}`);
  }

  private activeKey(hash: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `active:${hash}`);
  }

  private cooldownKey(hash: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `cooldown:${hash}`);
  }

  private rateChannelKey(hash: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `rate:channel:${hash}`);
  }

  private rateSubjectKey(hash: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `rate:subject:${hash}`);
  }

  private rateIpKey(hash: string) {
    return buildRedisKey(this.keyPrefix, 'otp', `rate:ip:${hash}`);
  }
}
