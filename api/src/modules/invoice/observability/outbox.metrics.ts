import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('greenflow.outbox');
const published = meter.createCounter('outbox_published_total');
const failures = meter.createCounter('outbox_publish_failures_total');
const dead = meter.createCounter('outbox_dead_total');
const claimToPublish = meter.createHistogram(
  'outbox_claim_to_publish_duration',
  { unit: 's' },
);

export const recordOutboxPublished = (type: string) =>
  published.add(1, { type });
export const recordOutboxFailure = (type: string) => failures.add(1, { type });
export const recordOutboxDead = (type: string) => dead.add(1, { type });
export const recordOutboxLatency = (type: string, seconds: number) =>
  claimToPublish.record(seconds, { type });

const pendingOldestAge = meter.createGauge(
  'outbox_pending_oldest_age_seconds',
  { unit: 's' },
);
export const recordOutboxPendingAge = (seconds: number) =>
  pendingOldestAge.record(seconds);
