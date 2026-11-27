import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAY_SECONDS,
  FAILED_JOB_RETENTION,
  QUEUE_RETENTION,
} from './queue-retention';
import { buildJobOptions } from './bullmq-queue.helpers';
import { SPLIT_QUEUES, testTwinOf } from './queue-routing';

const queueConfig = { defaultAttempts: 3, defaultBackoffMs: 1000 } as never;

describe('queue retention', () => {
  it.each([
    ['nfse-emission', 14],
    ['nfse-cancellation', 14],
    ['nfse-email', 14],
    ['nfse-doc-prep', 2],
    ['nfse-fiscal-reconcile', 2],
  ] as const)(
    '%s keeps completed jobs for %i days and failed ones for 30',
    (queue, days) => {
      expect(QUEUE_RETENTION[queue]).toEqual({
        removeOnComplete: { age: days * DAY_SECONDS },
        removeOnFail: { age: 30 * DAY_SECONDS, count: 5000 },
      });
    },
  );

  it('never keeps finished jobs forever (false) or drops them at once for these queues', () => {
    for (const retention of Object.values(QUEUE_RETENTION)) {
      expect(retention.removeOnComplete).toEqual(
        expect.objectContaining({ age: expect.any(Number) }),
      );
      expect(retention.removeOnComplete.age).toBeGreaterThan(0);
      expect(FAILED_JOB_RETENTION).toEqual(retention.removeOnFail);
    }
  });

  it('idempotent queues keep completed jobs without a count cap, so a busy day never evicts one inside the window', () => {
    for (const q of [
      'nfse-emission',
      'nfse-cancellation',
      'nfse-email',
    ] as const) {
      expect(QUEUE_RETENTION[q].removeOnComplete).not.toHaveProperty('count');
    }
  });

  it('emission window covers the documented replay path (outbox redelivery, 5-minute recovery sweep, operator re-run after an incident)', () => {
    const outboxRedeliveryMax = 60 * 60; // lease/backoff retries finish within an hour
    const recoverySweep = 5 * 60;
    const incidentRerun = 7 * DAY_SECONDS;
    const window = QUEUE_RETENTION['nfse-emission'].removeOnComplete.age;
    expect(window).toBeGreaterThan(outboxRedeliveryMax);
    expect(window).toBeGreaterThan(recoverySweep);
    expect(window).toBeGreaterThanOrEqual(incidentRerun);
    expect(QUEUE_RETENTION['nfse-cancellation'].removeOnComplete.age).toBe(
      window,
    );
  });

  it.each([
    'nfse-emission',
    'nfse-cancellation',
    'nfse-email',
    'nfse-doc-prep',
  ] as const)(
    'the test twin of %s keeps jobs exactly like the live queue',
    (q) => {
      expect(QUEUE_RETENTION[testTwinOf(q)]).toBe(QUEUE_RETENTION[q]);
    },
  );

  it('every retained split queue has a retained twin', () => {
    for (const base of SPLIT_QUEUES) {
      if (base in QUEUE_RETENTION)
        expect(QUEUE_RETENTION).toHaveProperty([testTwinOf(base)]);
    }
  });

  it('passes the options through to BullMQ unchanged', () => {
    const opts = buildJobOptions(queueConfig, {
      idempotencyKey: 'emission-i1',
      ...QUEUE_RETENTION['nfse-emission'],
    });
    expect(opts.removeOnComplete).toEqual({ age: 14 * DAY_SECONDS });
    expect(opts.removeOnFail).toEqual(FAILED_JOB_RETENTION);
  });

  it('no source file sets removeOnComplete: false again', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          path.endsWith('.ts') &&
          !path.endsWith('.spec.ts') &&
          /removeOnComplete:\s*false/.test(readFileSync(path, 'utf8'))
        )
          offenders.push(path);
      }
    };
    walk(join(__dirname, '..', '..'));
    expect(offenders).toEqual([]);
  });
});
