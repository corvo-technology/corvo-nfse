import {
  _context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { DelayedError } from 'bullmq';
import {
  processQueueJobWithTrace,
  publishQueueJobWithTrace,
} from './queue-trace-context';

describe('queue trace context', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a producer span and injects its context into the job payload', async () => {
    const span = fakeSpan();
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    jest.spyOn(propagation, 'inject').mockImplementation((_ctx, carrier) => {
      (carrier as Record<string, string>).traceparent =
        '00-11111111111111111111111111111111-2222222222222222-01';
    });
    const publish = jest.fn().mockResolvedValue('job-1');

    await expect(
      publishQueueJobWithTrace(
        'messaging.receive',
        'incoming-message',
        { messageId: 'message-1' },
        publish,
      ),
    ).resolves.toBe('job-1');

    expect(startActiveSpan).toHaveBeenCalledWith(
      'messaging.receive publish',
      expect.objectContaining({
        kind: SpanKind.PRODUCER,
        attributes: expect.objectContaining({
          'messaging.system': 'bullmq',
          'messaging.destination': 'messaging.receive',
          'messaging.operation': 'publish',
        }),
      }),
      expect.any(Function),
    );
    expect(publish).toHaveBeenCalledWith({
      messageId: 'message-1',
      _telemetry: {
        traceContext: {
          traceparent:
            '00-11111111111111111111111111111111-2222222222222222-01',
        },
      },
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('extracts the producer context and creates a consumer span for the job', async () => {
    const span = fakeSpan();
    const parentContext = ROOT_CONTEXT;
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    const extract = jest
      .spyOn(propagation, 'extract')
      .mockReturnValue(parentContext);
    const handler = jest.fn().mockResolvedValue('processed');

    await expect(
      processQueueJobWithTrace(
        'email.send',
        {
          id: 'job-7',
          name: 'charge-notification',
          attemptsMade: 1,
          data: {
            _telemetry: {
              traceContext: {
                traceparent:
                  '00-11111111111111111111111111111111-2222222222222222-01',
              },
            },
          },
        },
        handler,
      ),
    ).resolves.toBe('processed');

    expect(extract).toHaveBeenCalledWith(ROOT_CONTEXT, {
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    });
    expect(startActiveSpan).toHaveBeenCalledWith(
      'email.send process',
      expect.objectContaining({
        kind: SpanKind.CONSUMER,
        attributes: expect.objectContaining({
          'messaging.message_id': 'job-7',
          'messaging.bullmq.job.name': 'charge-notification',
          'messaging.bullmq.job.attempt': 2,
        }),
      }),
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('starts a safe root consumer span when the carrier is absent', async () => {
    const span = fakeSpan();
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    const extract = jest.spyOn(propagation, 'extract');

    await processQueueJobWithTrace(
      'reports.process',
      { data: null },
      async () => undefined,
    );

    expect(extract).not.toHaveBeenCalled();
    expect(startActiveSpan).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('falls back to a root span when the trace carrier is malformed', async () => {
    const span = fakeSpan();
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    jest.spyOn(propagation, 'extract').mockImplementation(() => {
      throw new Error('invalid trace carrier');
    });
    const handler = jest.fn().mockResolvedValue('processed');

    await expect(
      processQueueJobWithTrace(
        'reports.process',
        {
          data: {
            _telemetry: { traceContext: { traceparent: 'invalid' } },
          },
        },
        handler,
      ),
    ).resolves.toBe('processed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('records and rethrows processor failures', async () => {
    const span = fakeSpan();
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    const failure = new Error('processor failed');

    await expect(
      processQueueJobWithTrace('documents.process', { data: {} }, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(span.recordException).toHaveBeenCalledWith(failure);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'processor failed',
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('does not mark BullMQ control-flow exceptions as failures', async () => {
    const span = fakeSpan();
    const startActiveSpan = jest.fn(
      (
        _name: string,
        _options: unknown,
        callback: (value: unknown) => unknown,
      ) => callback(span),
    );
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    const delayed = new DelayedError();

    await expect(
      processQueueJobWithTrace('messaging.send', { data: {} }, async () => {
        throw delayed;
      }),
    ).rejects.toBe(delayed);

    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

function fakeSpan() {
  return {
    end: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
  };
}
