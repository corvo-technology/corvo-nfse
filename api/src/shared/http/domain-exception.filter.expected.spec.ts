import type { ArgumentsHost } from '@nestjs/common';
import { ApplicationError } from '@/shared/errors/application-error';
import { captureUnhandledHttpException } from '@/infra/observability/sentry-reporter';
import { DomainExceptionFilter } from './domain-exception.filter';

jest.mock('@/infra/observability/sentry-reporter', () => ({
  captureUnhandledHttpException: jest.fn(),
}));

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'r1', method: 'POST', url: '/v1/x' }),
      getResponse: () => ({ status, json }),
    }),
  } as unknown as ArgumentsHost;
  new DomainExceptionFilter().catch(exception, host);
  return { status, json };
}

const unavailable = (expected: boolean) =>
  new ApplicationError({
    code: 'DPS_NUMBERING_CHECK_UNAVAILABLE',
    kind: 'dependency',
    retryable: true,
    expected,
    safeMessage: 'O governo não respondeu agora.',
  });

describe('DomainExceptionFilter: expected failures of outside services', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers 503 with its own code and does not report to Sentry', () => {
    const { status, json } = run(unavailable(true));
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        code: expect.stringContaining('DPS_NUMBERING_CHECK_UNAVAILABLE'),
        message: 'Service temporarily unavailable',
      }),
    );
    expect(captureUnhandledHttpException).not.toHaveBeenCalled();
  });

  it('still reports a dependency failure that is not marked as expected', () => {
    const { status, json } = run(unavailable(false));
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Service temporarily unavailable' }),
    );
    expect(captureUnhandledHttpException).toHaveBeenCalledTimes(1);
  });
});
