import type { ErrorEvent } from '@sentry/nestjs';
import {
  buildSentryOptions,
  resolveSentryConfig,
  sanitizeSentryEvent,
} from './sentry-config';

describe('Sentry configuration', () => {
  it('is disabled and privacy-safe by default', () => {
    const options = buildSentryOptions(
      resolveSentryConfig({ NODE_ENV: 'test' }),
    );

    expect(options).toMatchObject({
      enabled: false,
      skipOpenTelemetrySetup: true,
      enableLogs: false,
      includeLocalVariables: false,
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      },
    });
  });

  it('resolves DSN, release and bounded operational settings from env', () => {
    expect(
      resolveSentryConfig({
        SENTRY_ENABLED: 'true',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        SENTRY_ENVIRONMENT: 'production',
        SENTRY_RELEASE: 'sha-123',
        SENTRY_ERROR_SAMPLE_RATE: '0.5',
        SENTRY_DEBUG: 'true',
        SENTRY_FLUSH_TIMEOUT_MS: '3500',
      }),
    ).toEqual({
      enabled: true,
      dsn: 'https://public@example.ingest.sentry.io/1',
      environment: 'production',
      release: 'sha-123',
      errorSampleRate: 0.5,
      debug: true,
      flushTimeoutMs: 3500,
    });
  });

  it('removes automatic HTTP and identity data before sending', () => {
    const event = {
      request: { url: '/pay?token=secret', headers: { authorization: 'x' } },
      user: { id: 'customer-1', email: 'private@example.com' },
      breadcrumbs: [{ message: 'sensitive navigation' }],
      extra: { rawBody: 'secret' },
      contexts: {
        request: { body: 'secret' },
        response: { body: 'secret' },
        greenflow: { route: '/v1/payables/:id/pay' },
      },
      exception: { values: [{ type: 'Error', value: 'failure' }] },
    } as unknown as ErrorEvent;

    expect(sanitizeSentryEvent(event)).toEqual({
      contexts: { greenflow: { route: '/v1/payables/:id/pay' } },
      exception: { values: [{ type: 'Error', value: 'failure' }] },
    });
  });

  it('keeps only explicitly safe context and breadcrumbs', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'greenflow.financial',
          message: 'must be removed',
          data: {
            operation: 'settle_accounts_payable',
            stage: 'persist_transaction',
            tenantId: 'tenant-secret',
            amount: '100.00',
          },
        },
        { category: 'http', data: { authorization: 'secret' } },
      ],
      contexts: {
        greenflow: {
          route: '/v1/tenant/:tenantId/financial/payables/:id/pay',
          errorCode: 'FINANCIAL_OPERATION_AUDIT_INCONSISTENT',
          tenantId: 'tenant-secret',
          body: { paidAt: 'secret' },
        },
      },
    } as unknown as ErrorEvent;

    expect(sanitizeSentryEvent(event)).toEqual({
      breadcrumbs: [
        {
          category: 'greenflow.financial',
          data: {
            operation: 'settle_accounts_payable',
            stage: 'persist_transaction',
          },
        },
      ],
      contexts: {
        greenflow: {
          route: '/v1/tenant/:tenantId/financial/payables/:id/pay',
          errorCode: 'FINANCIAL_OPERATION_AUDIT_INCONSISTENT',
        },
      },
    });
  });

  it('redacts credentials, email and business identifiers from exception messages', () => {
    const event = {
      message:
        'authorization=Bearer-secret user@example.com 34619b86-3b09-412b-8b72-e1b2c6895cb1',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'password=hunter2 token:abc123 Bearer ey.secret.value',
          },
        ],
      },
    } as unknown as ErrorEvent;

    expect(sanitizeSentryEvent(event)).toEqual({
      message: 'authorization=[REDACTED] [REDACTED_EMAIL] [REDACTED_ID]',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'password=[REDACTED] token:[REDACTED] Bearer [REDACTED]',
          },
        ],
      },
    });
  });
});
