import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/**
 * Production never waits for test. Queues that do heavy or external work (the fiscal portal,
 * PDF rendering, e-mail, a whole spreadsheet import) exist twice: the base name serves `live`
 * and `<name>-test` serves `test` (homologação), each with its own worker and concurrency.
 * A flood of test notes then only fills the test twin.
 *
 * Not split on purpose: `nfse-fiscal-reconcile` (database only, no external call), `import-read`
 * (local file parsing) and the generic `email` queue (OTP / welcome mail, not the invoice path).
 * NF-e / NFC-e have no queue: they run inside the outbox relay, which claims live first.
 */
export const SPLIT_QUEUES = [
  'nfse-emission',
  'nfse-reconciliation',
  'nfse-cancellation',
  'nfse-doc-prep',
  'nfse-email',
  'import-emit',
] as const;

export type SplitQueueName = (typeof SPLIT_QUEUES)[number];
export type TestQueueName = `${SplitQueueName}-test`;

export const TEST_QUEUE_SUFFIX = '-test';

export function testTwinOf<Q extends SplitQueueName>(
  base: Q,
): `${Q}${typeof TEST_QUEUE_SUFFIX}` {
  return `${base}${TEST_QUEUE_SUFFIX}`;
}

/** Every queue that must exist in Redis/Nest: each base queue and its test twin. */
export const SPLIT_QUEUE_NAMES: ReadonlyArray<SplitQueueName | TestQueueName> =
  SPLIT_QUEUES.flatMap((base) => [base, testTwinOf(base)]);

/**
 * THE routing point: the queue a job of this environment must be added to. The jobId stays the
 * same (idempotency per entity), and the environment of an invoice never changes, so one entity
 * can only ever be in one of the two queues.
 */
export function queueFor<Q extends SplitQueueName>(
  base: Q,
  environment: ExecutionEnvironment,
): Q | `${Q}${typeof TEST_QUEUE_SUFFIX}` {
  return environment === 'test' ? testTwinOf(base) : base;
}

/**
 * Queues where an existing job of this environment may still be found. A test job enqueued
 * before the split lives in the base queue, so lookups also check it.
 */
export function queuesHolding<Q extends SplitQueueName>(
  base: Q,
  environment: ExecutionEnvironment,
): Array<Q | `${Q}${typeof TEST_QUEUE_SUFFIX}`> {
  return environment === 'test' ? [testTwinOf(base), base] : [base];
}
