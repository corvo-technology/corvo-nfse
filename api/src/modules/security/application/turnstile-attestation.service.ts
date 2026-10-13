/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '@/infra/redis/redis.constants';

const ATTESTATION_PREFIX = 'gf:attest:';
const ATTESTATION_TTL_SECONDS = 1800; // 30 minutes

export interface TurnstileAttestation {
  tokenHash: string;
  action: string;
  hostname: string;
  productKey: string;
  tenantId: string | null;
  slug: string | null;
  createdAt: string;
  expiresAt: string;
  ipPrefixHash: string | null;
  userAgentHash: string | null;
}

@Injectable()
export class TurnstileAttestationService {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(input: {
    action: string;
    hostname: string;
    productKey: string;
    tenantId?: string;
    slug?: string;
    ipPrefix?: string;
    userAgent?: string;
  }): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = TurnstileAttestationService.hashToken(token);

    const now = new Date();
    const attestation: TurnstileAttestation = {
      tokenHash,
      action: input.action,
      hostname: input.hostname,
      productKey: input.productKey,
      tenantId: input.tenantId ?? null,
      slug: input.slug ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + ATTESTATION_TTL_SECONDS * 1000,
      ).toISOString(),
      ipPrefixHash: input.ipPrefix ? hashRiskSignal(input.ipPrefix) : null,
      userAgentHash: input.userAgent ? hashRiskSignal(input.userAgent) : null,
    };

    await this.redis.set(
      `${ATTESTATION_PREFIX}${tokenHash}`,
      JSON.stringify(attestation),
      'EX',
      ATTESTATION_TTL_SECONDS,
    );

    return token;
  }

  async assertVerifyRate(input: {
    ipPrefix: string;
    productKey: string;
    action: string;
    slug?: string;
  }): Promise<boolean> {
    const key = [
      'gf:turnstile:verify-rate',
      hashRiskSignal(input.ipPrefix),
      input.productKey,
      input.action,
      input.slug ?? '-',
    ].join(':');
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    return count <= 20;
  }

  async consume(token: string): Promise<TurnstileAttestation | null> {
    const tokenHash = TurnstileAttestationService.hashToken(token);
    const raw = await this.redis.getdel(`${ATTESTATION_PREFIX}${tokenHash}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async peek(token: string): Promise<TurnstileAttestation | null> {
    const tokenHash = TurnstileAttestationService.hashToken(token);
    const raw = await this.redis.get(`${ATTESTATION_PREFIX}${tokenHash}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }
}

function hashRiskSignal(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
