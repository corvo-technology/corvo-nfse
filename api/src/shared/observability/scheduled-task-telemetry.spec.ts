import { SpanStatusCode, trace } from '@opentelemetry/api';
import { captureRuntimeException } from '@/infra/observability/sentry-reporter';
import { observeScheduledTask } from './scheduled-task-telemetry';

jest.mock('@/infra/observability/sentry-reporter', () => ({
  captureRuntimeException: jest.fn(),
}));

describe('scheduled task telemetry', () => {
  const span = {
    end: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
  };
  const startActiveSpan = jest.fn(
    (
      _name: string,
      _options: unknown,
      callback: (value: typeof span) => unknown,
    ) => callback(span),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates a stable root span and returns the task result', async () => {
    await expect(
      observeScheduledTask('campaign.delivery-dispatch', async () => 3),
    ).resolves.toBe(3);

    expect(startActiveSpan).toHaveBeenCalledWith(
      'cron campaign.delivery-dispatch',
      expect.objectContaining({
        attributes: {
          'corvo.job.name': 'campaign.delivery-dispatch',
          'corvo.workload.kind': 'cron',
        },
      }),
      expect.any(Function),
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('records and rethrows failures', async () => {
    const failure = new Error('scheduled failure');
    await expect(
      observeScheduledTask('billing.provider-operations', () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(span.recordException).toHaveBeenCalledWith(failure);
    expect(span.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: SpanStatusCode.ERROR }),
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('reports a failing cron job to Sentry once, with the job name, and still rethrows it', async () => {
    const failure = new Error('relation "nfse_invoices" does not exist');

    await expect(
      observeScheduledTask('invoice.docs-recovery', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    // The cron runner swallows the error into a log line, so this is the only
    // place that can send it to Sentry.
    expect(captureRuntimeException).toHaveBeenCalledTimes(1);
    expect(captureRuntimeException).toHaveBeenCalledWith(
      failure,
      'worker',
      'cron:invoice.docs-recovery',
    );
  });

  it('does not report to Sentry when the job succeeds', async () => {
    await observeScheduledTask('invoice.docs-recovery', async () => undefined);

    expect(captureRuntimeException).not.toHaveBeenCalled();
  });
});
