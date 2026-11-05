import { ConflictException } from '@nestjs/common';
import type { PaymentIntent } from '../domain/payment-intent';

export interface ExpectedPurchase {
  provider: 'woovi' | 'stripe';
  kind: 'plan' | 'avulso';
  planSlug: string | null;
  cycle: string | null;
  units: number | null;
}

/**
 * An Idempotency-Key replays the same checkout, never a different one: same
 * provider and body, and an expired Pix charge needs a fresh key.
 */
export function assertReplayMatches(
  intent: PaymentIntent,
  expected: ExpectedPurchase,
): void {
  const same =
    intent.provider === expected.provider &&
    intent.kind === expected.kind &&
    intent.planSlug === expected.planSlug &&
    intent.cycle === expected.cycle &&
    intent.units === expected.units;
  if (!same)
    throw new ConflictException(
      'This Idempotency-Key was already used for a different purchase',
    );
  if (
    intent.status !== 'paid' &&
    intent.expiresAt &&
    intent.expiresAt.getTime() <= Date.now()
  )
    throw new ConflictException(
      'This checkout expired: retry with a new Idempotency-Key',
    );
}
