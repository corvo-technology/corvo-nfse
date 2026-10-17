import { InvalidCancellationReasonError } from './errors';

export const CANCELLATION_REASON_CODES = [
  'issue_error',
  'service_not_provided',
  'other',
] as const;
export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

export interface CancellationReason {
  code: CancellationReasonCode;
  description: string | null;
}

export function cancellationReason(
  code: CancellationReasonCode,
  description?: string | null,
): CancellationReason {
  const trimmed = description?.trim();
  return { code, description: trimmed ? trimmed : null };
}

/** Sefin TSMotivo (event 101101 xMotivo): 15 to 255 characters. */
export const CANCELLATION_DESCRIPTION_MIN = 15;
export const CANCELLATION_DESCRIPTION_MAX = 255;

export function assertFiscalCancellationReason(
  reason: CancellationReason,
): void {
  const length = reason.description?.length ?? 0;
  if (
    length < CANCELLATION_DESCRIPTION_MIN ||
    length > CANCELLATION_DESCRIPTION_MAX
  )
    throw new InvalidCancellationReasonError();
}
