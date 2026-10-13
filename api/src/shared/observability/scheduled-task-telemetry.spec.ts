import { SpanStatusCode, trace } from '@opentelemetry/api';
import { observeScheduledTask } from './scheduled-task-telemetry';

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
          'greenflow.job.name': 'campaign.delivery-dispatch',
          'greenflow.workload.kind': 'cron',
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
});
