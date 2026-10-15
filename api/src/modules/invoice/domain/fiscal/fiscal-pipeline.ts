import { fiscalError, type FiscalError } from './fiscal-error';
import type { FiscalContext, StepTrace } from './fiscal-context';
import type { FiscalStep } from './fiscal-step';
import { err, ok, type Result } from './result';

export interface PipelineObserver {
  stepFinished(
    step: string,
    status: StepTrace['status'],
    durationMs: number,
    errorCode?: string,
  ): void;
  pipelineFinished(ok: boolean, durationMs: number, errorCode?: string): void;
}

const NOOP_OBSERVER: PipelineObserver = {
  stepFinished() {},
  pipelineFinished() {},
};

export class FiscalPipeline {
  constructor(
    private readonly steps: readonly FiscalStep[],
    private readonly observer: PipelineObserver = NOOP_OBSERVER,
  ) {
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.name))
        throw new Error(`Duplicate fiscal step name: ${step.name}`);
      seen.add(step.name);
    }
  }

  async execute(
    initial: FiscalContext,
  ): Promise<Result<FiscalContext, FiscalError>> {
    const startedAt = performance.now();
    let context = initial;
    for (const step of this.steps) {
      const stepStartedAt = performance.now();
      const outcome = await step.execute(context);
      const durationMs = performance.now() - stepStartedAt;

      if (!outcome.ok) {
        const error: FiscalError = { ...outcome.error, step: step.name };
        this.observer.stepFinished(step.name, 'failed', durationMs, error.code);
        this.observer.pipelineFinished(
          false,
          performance.now() - startedAt,
          error.code,
        );
        return err(error);
      }
      if (outcome.value.status === 'skipped' && step.required) {
        const error = fiscalError({
          code: 'FISCAL_INTERNAL_ERROR',
          message: `Required fiscal step ${step.name} cannot be skipped`,
          category: 'INTERNAL',
          step: step.name,
          details: { reason: outcome.value.reason },
        });
        this.observer.stepFinished(step.name, 'failed', durationMs, error.code);
        this.observer.pipelineFinished(
          false,
          performance.now() - startedAt,
          error.code,
        );
        return err(error);
      }
      const trace: StepTrace = {
        step: step.name,
        status: outcome.value.status,
        durationMs,
        ...(outcome.value.status === 'skipped'
          ? { reason: outcome.value.reason }
          : {}),
      };
      this.observer.stepFinished(
        step.name,
        trace.status,
        durationMs,
        undefined,
      );
      context = {
        ...outcome.value.context,
        trace: [...outcome.value.context.trace, trace],
      };
    }
    this.observer.pipelineFinished(
      true,
      performance.now() - startedAt,
      undefined,
    );
    return ok(context);
  }
}
