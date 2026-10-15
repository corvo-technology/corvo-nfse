import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('corvo.fiscal');
const pipelineDuration = meter.createHistogram('corvo.fiscal.pipeline.duration', { unit: 's' });
const stepDuration = meter.createHistogram('corvo.fiscal.step.duration', { unit: 's' });
const stepFailed = meter.createCounter('corvo.fiscal.step.failed.total');
const stepSkipped = meter.createCounter('corvo.fiscal.step.skipped.total');
const dpsValidationFailed = meter.createCounter('corvo.fiscal.dps.validation.failed.total');
const reconciliationMismatch = meter.createCounter('corvo.fiscal.reconciliation.mismatch.total');
const calculateTotal = meter.createCounter('corvo.fiscal.calculate.total');
const calculateDuration = meter.createHistogram('corvo.fiscal.calculate.duration', { unit: 's' });
const authorizationFailed = metrics.getMeter('corvo.nfse').createCounter('corvo.nfse.authorization.failed.total');

export function recordFiscalStep(
  step: string,
  status: 'applied' | 'skipped' | 'failed',
  durationMs: number,
  errorCode?: string,
): void {
  stepDuration.record(durationMs / 1000, { step, status });
  if (status === 'failed') stepFailed.add(1, { step, code: errorCode ?? 'unknown' });
  if (status === 'skipped') stepSkipped.add(1, { step });
}

export function recordFiscalPipeline(ok: boolean, durationMs: number): void {
  pipelineDuration.record(durationMs / 1000, { ok: String(ok) });
}

/** The code must be a stable DPS error code, never free text. */
export function recordDpsValidationFailure(code: string): void {
  dpsValidationFailed.add(1, { code });
}

export function recordAuthorizationFailure(code: string): void {
  authorizationFailed.add(1, { code });
}

export function recordReconciliationMismatch(tenantId: string): void {
  reconciliationMismatch.add(1, { tenantId });
}

export function recordCalculate(status: 'ready' | 'blocked' | 'error', durationMs: number): void {
  calculateTotal.add(1, { status });
  calculateDuration.record(Math.max(durationMs, 0) / 1000, { status });
}
