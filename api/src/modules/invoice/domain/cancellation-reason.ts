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

/**
 * Fixed texts used when a queued invoice loses the race to the worker and the
 * original request carried no description. Each fits the 15-255 fiscal range.
 */
export const DEFAULT_CANCELLATION_DESCRIPTION: Record<
  CancellationReasonCode,
  string
> = {
  issue_error: 'Cancelamento solicitado pelo emitente por erro na emissão',
  service_not_provided:
    'Cancelamento solicitado pelo emitente: serviço não prestado',
  other: 'Cancelamento solicitado pelo emitente',
};

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
