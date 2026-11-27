/**
 * Two families of results, never mixed: business failures (the customer fixes the data) and
 * communication failures (Corvo consults or retries). Adapters never throw for either.
 */
export type GatewayOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'rejected'; code: string; message: string; hint?: string }
  | { kind: 'denied'; code: string; message: string }
  | { kind: 'uncertain'; reason: 'timeout' | 'network' | 'server' }
  | { kind: 'unavailable'; retryAfterMs?: number };

export function isBusinessFailure<T>(
  outcome: GatewayOutcome<T>,
): outcome is Extract<GatewayOutcome<T>, { kind: 'rejected' | 'denied' }> {
  return outcome.kind === 'rejected' || outcome.kind === 'denied';
}

export function isCommunicationFailure<T>(
  outcome: GatewayOutcome<T>,
): outcome is Extract<
  GatewayOutcome<T>,
  { kind: 'uncertain' | 'unavailable' }
> {
  return outcome.kind === 'uncertain' || outcome.kind === 'unavailable';
}
