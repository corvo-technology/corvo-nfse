import { Writable } from 'node:stream';
import pino from 'pino';
import {
  sanitizeRequestUrl,
  httpErrorLogMessage,
  httpErrorLogObject,
  sanitizeHttpRequest,
  SENSITIVE_LOG_REDACTION_PATHS,
} from './logging.module';

describe('SENSITIVE_LOG_REDACTION_PATHS', () => {
  it('redacts common secret fields from request body, query, and headers', () => {
    expect(SENSITIVE_LOG_REDACTION_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.proxy-authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.headers["x-api-key"]',
        'req.headers["x-access-token"]',
        'req.headers["taxid"]',
        'req.headers["pixkey"]',
        'req.headers["x-webhook-secret"]',
        'req.body.passwordChangeToken',
        'req.body.client_secret',
        'req.body.secret',
        'req.body.apiKey',
        'req.body.authorizationCode',
        'req.body.code',
        'req.body.token',
        'req.body.access_token',
        'req.body.refresh_token',
        'req.query.passwordChangeToken',
        'req.query.client_secret',
        'req.query.secret',
        'req.query.apiKey',
        'req.query.authorizationCode',
        'req.query.code',
        'req.query.state',
        'req.query.token',
        'req.query.access_token',
        'req.query.refresh_token',
        'req.body.*.passwordChangeToken',
        'req.body.*.client_secret',
        'req.query.*.refresh_token',
        'req.body.taxID',
        'req.body.pixKey',
        'req.body.providerResponse',
        'req.body.externalChargeId',
        'req.body.accessTokenEncrypted',
        'req.body.webhookSecret',
        'req.body.verifyToken',
        'err.query',
        'err.parameters',
        'err.detail',
        'err.where',
        'err.driverError.detail',
        'err.driverError.where',
      ]),
    );
  });

  it('redacts sensitive values from serialized log records', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(
      {
        redact: {
          paths: SENSITIVE_LOG_REDACTION_PATHS,
          censor: '[REDACTED]',
        },
      },
      stream,
    );

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer auth-secret',
          cookie: 'session=secret-cookie',
          'x-api-key': 'header-api-key',
          taxid: 'header-tax-id-secret',
          pixkey: 'header-pix-key-secret',
          'x-webhook-secret': 'header-sensitive-webhook-value',
        },
        body: {
          passwordChangeToken: 'password-change-secret',
          oauth: { client_secret: 'nested-client-secret' },
          token: 'body-token-secret',
          taxID: '12345678901',
          pixKey: 'seller@example.com',
          providerResponse: { raw: 'provider-secret' },
          externalChargeId: 'external-charge-secret',
          accessTokenEncrypted: 'encrypted-token-secret',
          webhookSecret: 'body-sensitive-webhook-value',
          verifyToken: 'verify-secret',
        },
        query: {
          code: 'query-code-secret',
          oauth: { refresh_token: 'nested-refresh-secret' },
        },
      },
      res: {
        headers: {
          'set-cookie': 'gf_human_login_dev=response-proof-secret; HttpOnly',
        },
      },
      err: {
        query: 'SELECT sensitive_query',
        parameters: ['sensitive-parameter'],
        detail: 'sensitive database detail',
        where: 'sensitive database context',
        driverError: {
          detail: 'sensitive driver detail',
          where: 'sensitive driver context',
        },
      },
    });

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('auth-secret');
    expect(output).not.toContain('secret-cookie');
    expect(output).not.toContain('header-api-key');
    expect(output).not.toContain('header-tax-id-secret');
    expect(output).not.toContain('header-pix-key-secret');
    expect(output).not.toContain('header-sensitive-webhook-value');
    expect(output).not.toContain('password-change-secret');
    expect(output).not.toContain('nested-client-secret');
    expect(output).not.toContain('body-token-secret');
    expect(output).not.toContain('query-code-secret');
    expect(output).not.toContain('nested-refresh-secret');
    expect(output).not.toContain('12345678901');
    expect(output).not.toContain('seller@example.com');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('external-charge-secret');
    expect(output).not.toContain('encrypted-token-secret');
    expect(output).not.toContain('body-sensitive-webhook-value');
    expect(output).not.toContain('verify-secret');
    expect(output).not.toContain('response-proof-secret');
    expect(output).not.toContain('sensitive_query');
    expect(output).not.toContain('sensitive-parameter');
    expect(output).not.toContain('sensitive database detail');
    expect(output).not.toContain('sensitive database context');
    expect(output).not.toContain('sensitive driver detail');
    expect(output).not.toContain('sensitive driver context');
  });

  it('redacts OAuth secrets embedded in the serialized request URL', () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(
      {
        serializers: { req: sanitizeHttpRequest },
        redact: {
          paths: SENSITIVE_LOG_REDACTION_PATHS,
          censor: '[REDACTED]',
        },
      },
      stream,
    );

    logger.info({
      req: {
        url: '/v1/google-calendar/oauth/callback?state=state-secret&code=code-secret&iss=https%3A%2F%2Faccounts.google.com&token=token-secret',
        originalUrl:
          '/v1/google-calendar/oauth/callback?state=original-state-secret&code=original-code-secret&scope=openid%20email',
        query: {
          state: 'query-state-secret',
          code: 'query-code-secret',
        },
      },
    });

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('accounts.google.com');
    expect(output).toContain('openid%20email');
    expect(output).not.toContain('state-secret');
    expect(output).not.toContain('code-secret');
    expect(output).not.toContain('token-secret');
    expect(output).not.toContain('query-state-secret');
    expect(output).not.toContain('query-code-secret');
  });

  it('removes the synthetic pino-http stack from server response access logs', () => {
    const error = new Error('failed with status code 500');
    const result = httpErrorLogObject({} as never, {} as never, error, {
      res: { statusCode: 500 },
      err: error,
      responseTime: 10,
    });

    expect(result).toEqual({
      res: { statusCode: 500 },
      responseTime: 10,
      event: 'http_request_failed',
    });
    expect(httpErrorLogMessage({} as never, {} as never, error)).toBe(
      'request completed with error response',
    );
  });

  it('preserves real transport errors in access logs', () => {
    const error = new Error('socket hang up');
    const result = httpErrorLogObject({} as never, {} as never, error, {
      err: error,
      responseTime: 5,
    });

    expect(result).toEqual({
      err: error,
      responseTime: 5,
      event: 'http_transport_error',
    });
    expect(httpErrorLogMessage({} as never, {} as never, error)).toBe(
      'request transport errored',
    );
  });
});

describe('webhook secrets in URLs', () => {
  it('redacts webhookSecret and signature query parameters', () => {
    expect(
      sanitizeRequestUrl(
        '/v1/integrations/inbound/abc?webhookSecret=s3cr3t&x=1',
      ),
    ).toBe('/v1/integrations/inbound/abc?webhookSecret=[REDACTED]&x=1');
    expect(sanitizeRequestUrl('/hook?a=1&signature=deadbeef')).toBe(
      '/hook?a=1&signature=[REDACTED]',
    );
  });
});
