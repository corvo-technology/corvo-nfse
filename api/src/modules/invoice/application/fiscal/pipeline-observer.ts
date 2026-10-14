import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { PipelineObserver } from '../../domain/fiscal/fiscal-pipeline';

const meter = metrics.getMeter('greenflow.fiscal');
const pipelineDuration = meter.createHistogram('fiscal_pipeline_duration', { unit: 's' });
const stepDuration = meter.createHistogram('fiscal_step_duration', { unit: 's' });
const stepFailed = meter.createCounter('fiscal_step_failed_total');
const stepSkipped = meter.createCounter('fiscal_step_skipped_total');

export class OtelPipelineObserver implements PipelineObserver {
  private readonly logger = new Logger('FiscalPipeline');
  constructor(private readonly context: { invoiceId: string; companyId: string; correlationId?: string }) {}

  stepFinished(step: string, status: 'applied' | 'skipped' | 'failed', durationMs: number, errorCode?: string): void {
    stepDuration.record(durationMs / 1000, { step, status });
    if (status === 'failed') stepFailed.add(1, { step, code: errorCode ?? 'unknown' });
    if (status === 'skipped') stepSkipped.add(1, { step });
    this.logger.log({ ...this.context, step, status, errorCode, durationMs: Math.round(durationMs) }, 'fiscal step finished');
  }

  pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void {
    pipelineDuration.record(durationMs / 1000, { ok: String(ok) });
    this.logger.log({ ...this.context, ok, errorCode, durationMs: Math.round(durationMs) }, 'fiscal pipeline finished');
  }
}
