import { metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  AGENT_RUNTIME_DURATION_BOUNDARIES_SECONDS,
  durationHistogramOptions,
} from './duration-histogram';

const duration = metrics
  .getMeter('greenflow.scheduled-task')
  .createHistogram(
    'greenflow.scheduled_task.duration',
    durationHistogramOptions(
      'Duration of scheduled application tasks',
      AGENT_RUNTIME_DURATION_BOUNDARIES_SECONDS,
    ),
  );

export function observeScheduledTask<T>(
  jobName: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  return trace.getTracer('greenflow.scheduled-task').startActiveSpan(
    `cron ${jobName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'greenflow.job.name': jobName,
        'greenflow.workload.kind': 'cron',
      },
    },
    async (span) => {
      const startedAt = performance.now();
      let status = 'ok';
      try {
        return await operation();
      } catch (error) {
        status = 'error';
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        duration.record(Math.max(performance.now() - startedAt, 0) / 1000, {
          'greenflow.job.name': jobName,
          status,
        });
        span.end();
      }
    },
  );
}
