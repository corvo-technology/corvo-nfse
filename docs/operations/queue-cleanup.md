# Redis queue cleanup

Finished BullMQ jobs now expire on their own (`api/src/infra/redis/queue-retention.ts` holds every window and the reason for it). That only applies to jobs created after the change. Jobs created before it were stored with `removeOnComplete: false` and stay in Redis until you remove them once.

## One-off cleanup

Run it once after deploying this change. It is never run automatically.

```bash
# inside the api container (needs REDIS_URL; REDIS_KEY_PREFIX defaults to "corvo")
node scripts/queue-clean.mjs            # dry run: prints completed/failed counts per queue
node scripts/queue-clean.mjs --apply    # deletes finished jobs older than each queue's window
```

From a checkout: `cd api && yarn build && yarn queue:clean [--apply]`.

The script reads the windows from the build (`dist/infra/redis/queue-retention.js`), so it removes only jobs older than the window of their queue. Younger jobs stay, because for emission, cancellation and e-mail the job id is the idempotency key. Run the dry run first, then `--apply`. It deletes in batches of 1000 and is safe to run again.

Age is only checked when another job of the same queue finishes, so an idle queue can keep a few old jobs. Running the script again later removes them.

## Windows

| Queue | Completed kept | Failed kept |
| --- | --- | --- |
| `nfse-emission`, `nfse-cancellation`, `nfse-email` | 14 days | 30 days (max 5000) |
| `nfse-doc-prep`, `nfse-fiscal-reconcile` | 2 days | 30 days (max 5000) |
