import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
class InMemoryMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

describe('fiscal, RTC and outbox metric contract', () => {
  it('exports names, scopes, seconds and stable attributes', async () => {
    const reader = new InMemoryMetricReader();
    const provider = new MeterProvider({ readers: [reader] });
    expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
    try {
const {
  recordAuthorizationFailure,
  recordDpsValidationFailure,
  recordCalculate,
  recordReconciliationMismatch,
} = jest.requireActual<typeof import('./fiscal.metrics')>('./fiscal.metrics');
const { OtelPipelineObserver } = jest.requireActual<typeof import('./pipeline-observer')>('./pipeline-observer');
const {
  recordRtcCalculationDuration,
  recordRtcCalculationFailure,
  recordRtcCalculatorLatency,
} = jest.requireActual<typeof import('../../infra/fiscal/rtc/rtc.metrics')>('../../infra/fiscal/rtc/rtc.metrics');
const {
  recordOutboxDead,
  recordOutboxFailure,
  recordOutboxLatency,
  recordOutboxPendingAge,
  recordOutboxPublished,
} = jest.requireActual<typeof import('../../observability/outbox.metrics')>('../../observability/outbox.metrics');


      const observer = new OtelPipelineObserver({
        invoiceId: 'invoice-1',
        companyId: 'company-1',
      });
      observer.stepFinished('classify', 'failed', 250, 'CLASSIFICATION_MISSING');
      observer.stepFinished('rtc', 'skipped', 5);
      observer.pipelineFinished(false, 500);
      recordDpsValidationFailure('DPS_SCHEMA_INVALID');
      recordAuthorizationFailure('ISSUE_REJECTED');
      recordReconciliationMismatch('tenant-1');
      recordCalculate('ready', 100);
      recordCalculate('blocked', 200);
      recordCalculate('error', 300);
      recordRtcCalculationDuration(0.3, 'ok');
      recordRtcCalculationFailure('timeout');
      recordRtcCalculatorLatency(0.2, '/calculadora/regime-geral');
      recordOutboxPublished('invoice.emit');
      recordOutboxFailure('invoice.emit');
      recordOutboxDead('invoice.emit');
      recordOutboxLatency('invoice.emit', 0.1);
      recordOutboxPendingAge(100);

      const { resourceMetrics } = await reader.collect();
      const exported = resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.map((metric) => ({ scope: scope.scope.name, metric })),
      );
      const contracts = [
        ['corvo.fiscal.pipeline.duration', 'corvo.fiscal', { ok: 'false' }],
        ['corvo.fiscal.step.duration', 'corvo.fiscal', { step: 'classify', status: 'failed' }],
        ['corvo.fiscal.step.failed.total', 'corvo.fiscal', { step: 'classify', code: 'CLASSIFICATION_MISSING' }],
        ['corvo.fiscal.step.skipped.total', 'corvo.fiscal', { step: 'rtc' }],
        ['corvo.fiscal.dps.validation.failed.total', 'corvo.fiscal', { code: 'DPS_SCHEMA_INVALID' }],
        ['corvo.nfse.authorization.failed.total', 'corvo.nfse', { code: 'ISSUE_REJECTED' }],
        ['corvo.fiscal.reconciliation.mismatch.total', 'corvo.fiscal', { tenantId: 'tenant-1' }],
        ['corvo.fiscal.calculate.total', 'corvo.fiscal', { status: 'ready' }],
        ['corvo.fiscal.calculate.total', 'corvo.fiscal', { status: 'blocked' }],
        ['corvo.fiscal.calculate.total', 'corvo.fiscal', { status: 'error' }],
        ['corvo.fiscal.calculate.duration', 'corvo.fiscal', { status: 'ready' }],
        ['corvo.rtc.calculation.duration', 'corvo.rtc', { outcome: 'ok' }],
        ['corvo.rtc.calculation.failed.total', 'corvo.rtc', { reason: 'timeout' }],
        ['corvo.rtc.request.duration', 'corvo.rtc', { path: '/calculadora/regime-geral' }],
        ['corvo.outbox.published.total', 'corvo.outbox', { type: 'invoice.emit' }],
        ['corvo.outbox.publish.failed.total', 'corvo.outbox', { type: 'invoice.emit' }],
        ['corvo.outbox.dead.total', 'corvo.outbox', { type: 'invoice.emit' }],
        ['corvo.outbox.claim_to_publish.duration', 'corvo.outbox', { type: 'invoice.emit' }],
        ['corvo.outbox.pending.oldest_age', 'corvo.outbox', {}],
      ] as const;
      for (const [name, scope, attributes] of contracts) {
        const found = exported.find(({ metric }) => metric.descriptor.name === name);
        expect(found?.scope).toBe(scope);
        expect(found?.metric.dataPoints).toEqual(
          expect.arrayContaining([expect.objectContaining({ attributes })]),
        );
        if (name.endsWith('.duration') || name.endsWith('.oldest_age')) {
          expect(found?.metric.descriptor.unit).toBe('s');
        }
      }
      expect(exported.some(({ metric }) => metric.descriptor.name.startsWith('greenflow.'))).toBe(false);
    } finally {
      await provider.shutdown();
      metrics.disable();
    }
  });
});
