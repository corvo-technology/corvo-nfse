/** What is stored and logged when the portal could not even be reached. */
export const NO_PORTAL_CONNECTION = 'Sem conexão com o portal do governo';

/** Socket-level codes that mean "the connection was never established or was cut". */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

type Causal = { name?: unknown; code?: unknown; cause?: unknown };

/**
 * True when the call failed at connection level (could not open or keep the connection to the
 * portal). The library reports a connect timeout as "Requisição excedeu 60000ms" although it gave
 * up after seconds; a real wait for the portal's answer (headers or body timeout) is not one.
 */
export function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const e = current as Causal;
    if (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) return true;
    if (e.name === 'ConnectTimeoutError') return true;
    current = e.cause;
  }
  return false;
}

/** The message to store: the real cause class when the connection failed, the error's own otherwise. */
export function failureMessage(error: unknown, fallback?: string): string {
  if (isConnectionFailure(error)) return NO_PORTAL_CONNECTION;
  if (error instanceof Error) return error.message;
  // The library's retry results carry the failure as a plain object, not an Error instance.
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message) return message;
  return fallback ?? 'Uncertain fiscal result';
}
