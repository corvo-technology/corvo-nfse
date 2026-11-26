import {
  failureMessage,
  isConnectionFailure,
  NO_PORTAL_CONNECTION,
} from './connection-failure';

/** Shaped like open-nfse: TimeoutError / NetworkError carrying the transport error as cause. */
const libraryError = (
  name: string,
  message: string,
  cause: { name?: string; code?: string },
) => Object.assign(new Error(message, { cause }), { name });

describe('connection failure text', () => {
  it('names a connect timeout instead of "Requisição excedeu 60000ms"', () => {
    const error = libraryError('TimeoutError', 'Requisição excedeu 60000ms.', {
      name: 'ConnectTimeoutError',
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    expect(isConnectionFailure(error)).toBe(true);
    expect(failureMessage(error)).toBe(NO_PORTAL_CONNECTION);
  });

  it('names a refused, reset or unresolved connection', () => {
    for (const code of [
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EHOSTUNREACH',
    ])
      expect(
        failureMessage(
          libraryError('NetworkError', `Erro de rede: ${code}`, { code }),
        ),
      ).toBe(NO_PORTAL_CONNECTION);
  });

  it('finds the cause one level deeper (fetch failed)', () => {
    const inner = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    const error = new TypeError('fetch failed', { cause: inner });
    expect(isConnectionFailure(error)).toBe(true);
  });

  it('keeps the real message when the portal was reached but took 60s to answer', () => {
    const error = libraryError('TimeoutError', 'Requisição excedeu 60000ms.', {
      name: 'HeadersTimeoutError',
      code: 'UND_ERR_HEADERS_TIMEOUT',
    });
    expect(isConnectionFailure(error)).toBe(false);
    expect(failureMessage(error)).toBe('Requisição excedeu 60000ms.');
  });

  it('keeps other errors and non-errors as they are', () => {
    expect(failureMessage(new Error('boom'))).toBe('boom');
    expect(failureMessage('weird', 'Uncertain fiscal result')).toBe(
      'Uncertain fiscal result',
    );
  });
});
