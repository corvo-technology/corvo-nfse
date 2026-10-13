import { createHmac } from 'node:crypto';
import type {
  OtpChannel,
  OtpScopeInput,
  StoredOtpChallenge,
} from './otp.types';

export function hmacValue(secret: string, value: unknown): string {
  return createHmac('sha256', secret)
    .update(canonicalSerialize(value))
    .digest('hex');
}

export function computeTargetHash(
  secret: string,
  channel: OtpChannel,
  target: string,
): string {
  return hmacValue(secret, { channel, target });
}

export function computeScopeHashes(secret: string, input: OtpScopeInput) {
  const productHash = hmacValue(secret, { productKey: input.productKey });
  const subjectHash = hmacValue(secret, {
    audience: input.audience,
    productHash,
    subjectId: input.subjectId,
  });
  const targetHash = computeTargetHash(secret, input.channel, input.target);
  const contextHash = hmacValue(secret, { contextId: input.contextId ?? null });
  const scopeHash = hmacValue(secret, {
    audience: input.audience,
    productHash,
    channel: input.channel,
    purpose: input.purpose,
    subjectHash,
    targetHash,
    contextHash,
  });
  return { productHash, subjectHash, targetHash, contextHash, scopeHash };
}

export function computeCodeHmac(
  secret: string,
  challenge: Omit<StoredOtpChallenge, 'codeHash' | 'attempts'>,
  code: string,
): string {
  return hmacValue(secret, { ...challenge, code });
}

export function recomputeCodeHash(
  secret: string,
  challenge: StoredOtpChallenge,
  code: string,
): string {
  const { codeHash: _codeHash, attempts: _attempts, ...immutable } = challenge;
  return computeCodeHmac(secret, immutable, code);
}

export function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalSerialize(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalSerialize(record[key] ?? null)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
