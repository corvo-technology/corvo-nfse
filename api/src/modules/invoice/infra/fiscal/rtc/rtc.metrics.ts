import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('corvo.rtc');
const calculationDuration = meter.createHistogram('corvo.rtc.calculation.duration', {
  unit: 's',
});
const calculationFailed = meter.createCounter('corvo.rtc.calculation.failed.total');
const calculatorLatency = meter.createHistogram('corvo.rtc.request.duration', {
  unit: 's',
});

/**
 * Duração de `calculate()` até o resultado final; `outcome` é 'ok' ou o
 * código do FiscalError propagado (ex.: TAX_CALCULATION_UNAVAILABLE).
 */
export const recordRtcCalculationDuration = (
  seconds: number,
  outcome: string,
): void => calculationDuration.record(seconds, { outcome });

/** Falhas de cálculo pelo motivo normalizado (timeout, network, upstream_5xx...). */
export const recordRtcCalculationFailure = (reason: string): void =>
  calculationFailed.add(1, { reason });

/** Latência por chamada HTTP à Calculadora, sempre por caminho — nunca por corpo. */
export const recordRtcCalculatorLatency = (
  seconds: number,
  path: string,
): void => calculatorLatency.record(seconds, { path });
