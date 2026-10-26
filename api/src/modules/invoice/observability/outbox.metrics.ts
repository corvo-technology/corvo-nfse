import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('corvo.outbox');
const published = meter.createCounter('corvo.outbox.published.total');
const failures = meter.createCounter('corvo.outbox.publish.failed.total');
const dead = meter.createCounter('corvo.outbox.dead.total');
const claimToPublish = meter.createHistogram(
  'corvo.outbox.claim_to_publish.duration',
  { unit: 's' },
);

export const recordOutboxPublished = (type: string) =>
  published.add(1, { type });
export const recordOutboxFailure = (type: string) => failures.add(1, { type });
export const recordOutboxDead = (type: string) => dead.add(1, { type });
export const recordOutboxLatency = (type: string, seconds: number) =>
  claimToPublish.record(seconds, { type });

const pendingOldestAge = meter.createGauge('corvo.outbox.pending.oldest_age', {
  unit: 's',
});
export const recordOutboxPendingAge = (seconds: number) =>
  pendingOldestAge.record(seconds);
