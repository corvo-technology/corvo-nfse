import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { z } from 'zod';
import type {
  AppConfiguration,
  OtpConfig,
  RedisConfig,
} from '@/infra/config/configuration';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';
import { buildRedisKey } from '@/infra/redis/redis-key.util';
import { computeScopeHashes } from '../domain/otp-hmac';
import { normalizeOtpTarget } from '../domain/otp-normalize';
import type { OtpScopeInput, OtpVerificationProof } from '../domain/otp.types';
import { OTP_PURPOSES } from '../domain/otp.types';
import { recordOtpEvent } from '../../observability/security.metrics';

const storedProofSchema = z.object({
  version: z.literal(1),
  audience: z.enum(['public', 'authenticated']),
  productHash: z.string().length(64),
  channel: z.enum(['email', 'whatsapp']),
  purpose: z.enum(OTP_PURPOSES),
  subjectHash: z.string().length(64),
  targetHash: z.string().length(64),
  contextHash: z.string().length(64),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
});

@Injectable()
export class OtpVerificationProofService {
  private readonly keyPrefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService<AppConfiguration>,
  ) {
    this.keyPrefix = configService.getOrThrow<RedisConfig>('redis').keyPrefix;
  }

  async create(scopeInput: OtpScopeInput): Promise<{
    token: string;
    expiresAt: number;
  }> {
    const config = this.config();
    const target = normalizeOtpTarget(scopeInput.channel, scopeInput.target);
    const scope = computeScopeHashes(config.hmacSecret, {
      ...scopeInput,
      target,
    });
    const token = randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    const expiresAt = createdAt + config.proofTtlSeconds * 1000;
    const proof: OtpVerificationProof = {
      version: 1,
      audience: scopeInput.audience,
      productHash: scope.productHash,
      channel: scopeInput.channel,
      purpose: scopeInput.purpose,
      subjectHash: scope.subjectHash,
      targetHash: scope.targetHash,
      contextHash: scope.contextHash,
      createdAt,
      expiresAt,
    };
    await this.redis.set(
      this.key(token),
      JSON.stringify(proof),
      'EX',
      config.proofTtlSeconds,
    );
    return { token, expiresAt };
  }

  async consume(
    token: string,
    expected: OtpScopeInput,
  ): Promise<OtpVerificationProof | null> {
    if (!token?.trim()) return null;
    const raw = await this.redis.getdel(this.key(token));
    if (!raw) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return null;
    }
    const parsed = storedProofSchema.safeParse(decoded);
    if (!parsed.success) return null;
    const proof: OtpVerificationProof = parsed.data;
    if (proof.expiresAt <= Date.now()) return null;
    const config = this.config();
    const target = normalizeOtpTarget(expected.channel, expected.target);
    const scope = computeScopeHashes(config.hmacSecret, {
      ...expected,
      target,
    });
    if (
      proof.audience !== expected.audience ||
      proof.productHash !== scope.productHash ||
      proof.channel !== expected.channel ||
      proof.purpose !== expected.purpose ||
      proof.subjectHash !== scope.subjectHash ||
      proof.targetHash !== scope.targetHash ||
      proof.contextHash !== scope.contextHash
    ) {
      recordOtpEvent(
        'proof_binding_rejected',
        proof.channel,
        proof.purpose,
        proof.audience,
      );
      return null;
    }
    recordOtpEvent(
      'proof_consumed',
      proof.channel,
      proof.purpose,
      proof.audience,
    );
    return proof;
  }

  private key(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return buildRedisKey(this.keyPrefix, 'otp', `proof:${hash}`);
  }

  private config(): OtpConfig {
    return this.configService.getOrThrow<OtpConfig>('otp');
  }
}
