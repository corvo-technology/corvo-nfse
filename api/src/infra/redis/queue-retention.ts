import type { KeepJobs } from 'bullmq';

/**
 * How long finished BullMQ jobs stay in Redis, per queue.
 *
 * BullMQ semantics (v5): `false` keeps jobs forever, `true`/`0` removes them at once,
 * a number keeps the last N, `{ age }` keeps jobs younger than `age` seconds. Age is
 * only evaluated when another job of the same kind finishes, so on an idle queue old
 * jobs can linger until the one-off cleanup (`yarn queue:clean`) runs.
 *
 * Why not remove at once: for the queues below the BullMQ `jobId` is the idempotency
 * key. A second `add` with the same jobId is ignored only while the old job still
 * exists (completed or failed). So the "completed" window must cover the longest
 * realistic replay (outbox redelivery, recovery sweeps, manual retries, API replays).
 * The database guards (invoice status machine, unique idempotency keys) are a second
 * line of defence, not the first.
 */
export const DAY_SECONDS = 24 * 60 * 60;

/** Failed jobs: kept long for debugging; also blocks a re-add of the same jobId meanwhile. Count caps a mass failure. */
export const FAILED_JOB_RETENTION: KeepJobs = {
  age: 30 * DAY_SECONDS,
  count: 5000,
};

/**
 * Emission, cancellation and e-mail: jobId is `emission-{invoiceId}`, `cancellation-{requestId}`,
 * `email-auto-{invoiceId}` / `email-resend-{invoiceId}-{key}`. Replays come from outbox redelivery
 * (minutes), recovery sweeps (every 5 min), customer retries with the same Idempotency-Key and
 * operators re-running things after an incident (days). 14 days covers all of them; no count limit,
 * so a busy day can never evict a job that is still inside the window.
 */
export const IDEMPOTENT_JOB_RETENTION = {
  removeOnComplete: { age: 14 * DAY_SECONDS } satisfies KeepJobs,
  removeOnFail: FAILED_JOB_RETENTION,
};

/**
 * Doc-prep (PDF/XML), PDF refresh and fiscal reconcile: the work is safe to repeat. Doc-prep
 * skips when `documentsReadyAt` is set, fiscal reconcile does an idempotent insert, and the
 * recovery sweep only re-adds invoices the database still shows as pending. 2 days is enough
 * to avoid a double run during an incident and keeps Redis small.
 */
export const REPEATABLE_JOB_RETENTION = {
  removeOnComplete: { age: 2 * DAY_SECONDS } satisfies KeepJobs,
  removeOnFail: FAILED_JOB_RETENTION,
};

/** Test twins (`<name>-test`, see queue-routing.ts) keep jobs exactly as long as their live queue. */
export const QUEUE_RETENTION = {
  'nfse-emission': IDEMPOTENT_JOB_RETENTION,
  'nfse-emission-test': IDEMPOTENT_JOB_RETENTION,
  'nfse-cancellation': IDEMPOTENT_JOB_RETENTION,
  'nfse-cancellation-test': IDEMPOTENT_JOB_RETENTION,
  'nfse-email': IDEMPOTENT_JOB_RETENTION,
  'nfse-email-test': IDEMPOTENT_JOB_RETENTION,
  'nfse-doc-prep': REPEATABLE_JOB_RETENTION,
  'nfse-doc-prep-test': REPEATABLE_JOB_RETENTION,
  'nfse-fiscal-reconcile': REPEATABLE_JOB_RETENTION,
} as const;

export type RetainedQueueName = keyof typeof QUEUE_RETENTION;
