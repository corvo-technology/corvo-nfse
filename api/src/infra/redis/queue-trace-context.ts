import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
} from '@opentelemetry/api';
import {
  DelayedError,
  RateLimitError,
  WaitingChildrenError,
  WaitingError,
} from 'bullmq';
import { QueueJobPayload, QueueName } from './queue.port';

const QUEUE_TRACER_NAME = 'greenflow.bullmq';

export type QueueTraceJob = {
  data?: unknown;
  id?: string | number;
  name?: string;
  attemptsMade?: number;
};

export function withTraceContext(payload: QueueJobPayload): QueueJobPayload {
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);

  if (Object.keys(traceContext).length === 0) {
    return payload;
  }

  return {
    ...payload,
    _telemetry: {
      ...(isRecord(payload._telemetry) ? payload._telemetry : {}),
      traceContext,
    },
  };
}

export function publishQueueJobWithTrace<T>(
  queueName: QueueName,
  jobName: string,
  payload: QueueJobPayload,
  publish: (payload: QueueJobPayload) => Promise<T>,
): Promise<T> {
  return runQueueSpan(
    `${queueName} publish`,
    SpanKind.PRODUCER,
    queueAttributes(queueName, 'publish', { jobName }),
    () => publish(withTraceContext(payload)),
  );
}

export function processQueueJobWithTrace<T>(
  queueName: QueueName,
  job: QueueTraceJob,
  process: () => T | Promise<T>,
): Promise<T> {
  const parentContext = extractParentContext(job.data);

  return context.with(parentContext, () =>
    runQueueSpan(
      `${queueName} process`,
      SpanKind.CONSUMER,
      queueAttributes(queueName, 'process', {
        jobId: job.id,
        jobName: job.name,
        attempt: (job.attemptsMade ?? 0) + 1,
      }),
      process,
    ),
  );
}

export function TraceQueueJob(queueName: QueueName): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') {
      throw new TypeError('TraceQueueJob can only decorate methods');
    }
    const processor = original as (
      this: unknown,
      ...args: unknown[]
    ) => unknown;

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const job = isRecord(args[0]) ? (args[0] as QueueTraceJob) : {};
      return processQueueJobWithTrace(queueName, job, () =>
        Reflect.apply(processor, this, args),
      );
    };
  };
}

function extractParentContext(payload: unknown): Context {
  const carrier = traceCarrier(payload);
  if (carrier === undefined) return ROOT_CONTEXT;

  try {
    return propagation.extract(ROOT_CONTEXT, carrier);
  } catch {
    return ROOT_CONTEXT;
  }
}

function traceCarrier(payload: unknown): Record<string, string> | undefined {
  if (!isRecord(payload) || !isRecord(payload._telemetry)) return undefined;
  const carrier = payload._telemetry.traceContext;
  if (!isRecord(carrier)) return undefined;

  const entries = Object.entries(carrier).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function queueAttributes(
  queueName: QueueName,
  operation: 'publish' | 'process',
  job: {
    jobId?: string | number;
    jobName?: string;
    attempt?: number;
  },
): Attributes {
  return {
    'messaging.system': 'bullmq',
    'messaging.destination': queueName,
    'messaging.destination_kind': 'queue',
    'messaging.operation': operation,
    ...(job.jobId === undefined
      ? {}
      : { 'messaging.message_id': String(job.jobId) }),
    ...(job.jobName === undefined
      ? {}
      : { 'messaging.bullmq.job.name': job.jobName }),
    ...(job.attempt === undefined
      ? {}
      : { 'messaging.bullmq.job.attempt': job.attempt }),
  };
}

function runQueueSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  operation: () => T | Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(QUEUE_TRACER_NAME);

  return tracer.startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await operation();
    } catch (error) {
      if (!isBullmqControlFlowError(error)) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

function isBullmqControlFlowError(error: unknown): boolean {
  return (
    error instanceof DelayedError ||
    error instanceof RateLimitError ||
    error instanceof WaitingChildrenError ||
    error instanceof WaitingError
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
