import type { MetricOptions } from '@opentelemetry/api';

export const TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
] as const;

export const TYPEORM_TRANSACTION_DURATION_BOUNDARIES_SECONDS = [
  ...TYPEORM_OPERATION_DURATION_BOUNDARIES_SECONDS,
  15,
  30,
  60,
  120,
] as const;

export const POSTGRES_POOL_DURATION_BOUNDARIES_SECONDS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 30,
] as const;

export const AGENT_RUNTIME_DURATION_BOUNDARIES_SECONDS = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 45, 60, 90, 120,
  180, 300,
] as const;

export function durationHistogramOptions(
  description: string,
  explicitBucketBoundaries: readonly number[],
): MetricOptions {
  return {
    description,
    unit: 's',
    advice: { explicitBucketBoundaries: [...explicitBucketBoundaries] },
  };
}
