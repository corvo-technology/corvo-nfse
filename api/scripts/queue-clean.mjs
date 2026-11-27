// One-off cleanup of old finished jobs in Redis. NOT run automatically.
//
// New jobs already expire by themselves (src/infra/redis/queue-retention.ts). Jobs
// created before that change were stored with `removeOnComplete: false` and stay
// forever, so run this once after deploying.
//
//   node scripts/queue-clean.mjs            # dry run: only prints how many jobs each queue holds
//   node scripts/queue-clean.mjs --apply    # deletes completed/failed jobs older than the retention window
//
// Uses the same windows as the code (read from dist/), so it never removes a job that
// could still be the idempotency record of a recent emission. Needs REDIS_URL and,
// if set in the app, REDIS_KEY_PREFIX (default "corvo").
import { Queue } from 'bullmq';
import { QUEUE_RETENTION } from '../dist/infra/redis/queue-retention.js';

const apply = process.argv.includes('--apply');
const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL is required.');
const prefix = `${process.env.REDIS_KEY_PREFIX ?? 'corvo'}:queue`;
const BATCH = 1000;

const graceMs = (keep) => (typeof keep === 'object' ? keep.age * 1000 : 0);

for (const [name, retention] of Object.entries(QUEUE_RETENTION)) {
  const queue = new Queue(name, {
    prefix,
    connection: { url, maxRetriesPerRequest: null },
  });
  try {
    const counts = await queue.getJobCounts('completed', 'failed');
    console.log(
      `${name}: completed=${counts.completed} failed=${counts.failed}`,
    );
    if (!apply) continue;
    for (const [state, keep] of [
      ['completed', retention.removeOnComplete],
      ['failed', retention.removeOnFail],
    ]) {
      let removed = 0;
      for (;;) {
        const ids = await queue.clean(graceMs(keep), BATCH, state);
        removed += ids.length;
        if (ids.length < BATCH) break;
      }
      console.log(
        `  removed ${removed} ${state} job(s) older than ${graceMs(keep) / 86_400_000} day(s)`,
      );
    }
  } finally {
    await queue.close();
  }
}
if (!apply) console.log('Dry run. Add --apply to delete.');
