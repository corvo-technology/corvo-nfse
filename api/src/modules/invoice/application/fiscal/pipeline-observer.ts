import { Logger } from '@nestjs/common';
import { recordFiscalPipeline, recordFiscalStep } from './fiscal.metrics';
import type { PipelineObserver } from '../../domain/fiscal/fiscal-pipeline';

export class OtelPipelineObserver implements PipelineObserver {
  private readonly logger = new Logger('FiscalPipeline');
  constructor(
    private readonly context: {
      invoiceId: string;
      companyId: string;
      correlationId?: string;
    },
  ) {}

  stepFinished(
    step: string,
    status: 'applied' | 'skipped' | 'failed',
    durationMs: number,
    errorCode?: string,
  ): void {
    recordFiscalStep(step, status, durationMs, errorCode);
    this.logger.log(
      {
        ...this.context,
        step,
        status,
        errorCode,
        durationMs: Math.round(durationMs),
      },
      'fiscal step finished',
    );
  }

  pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void {
    recordFiscalPipeline(ok, durationMs);
    this.logger.log(
      { ...this.context, ok, errorCode, durationMs: Math.round(durationMs) },
      'fiscal pipeline finished',
    );
  }
}
