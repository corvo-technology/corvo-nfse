import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  runRetentionRule,
  type RetentionRule,
} from '@/infra/retention/data-retention';
import { noticeRetentionRules } from '@/infra/retention/notice-retention';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import type { IOutboxRetention } from '../domain/outbox-retention';

export const OUTBOX_COMPLETED_KEEP_DAYS = 14;
export const OUTBOX_DEAD_KEEP_DAYS = 90;
export const OUTBOX_TEST_KEEP_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Only rows already finished (`completed` or `dead`) are ever candidates, so `pending` and `claimed`
 * (including messages scheduled for the future, which are `pending`) can never match. `updated_at` is
 * the finish time: `complete()` and `markDead()` both set it, and nothing touches a finished row
 * afterwards. (`completed_at` is empty on `dead` rows, which is why it is not used.)
 *
 * About `dedupe_key`: the unique key (tenant_id, dedupe_key) only exists so that the same step, inserted
 * twice in a short window, becomes one message. Every key carries the id of the thing it is about
 * (`calc:{invoiceId}`, `emission:{invoiceId}`, `cancellation:{requestId}`, `{type}:{eventId}:{attempt}`).
 * A message is enqueued in the same transaction as the state change that needs it, and a repeat of that
 * state change is stopped by the state itself (the invoice idempotency key and its status), not by this
 * table. After 14 days a finished message is long past any retry, so freeing its key cannot let a
 * duplicate through. As a second guard, a finished row is kept while the same aggregate (invoice or
 * document) still has a `pending` or `claimed` message, i.e. is still in flight.
 */
export function outboxRetentionRules(
  schema: string,
  now = new Date(),
): RetentionRule[] {
  const table = `${schema}.outbox_messages`;
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const notInFlight = `NOT EXISTS (
    SELECT 1 FROM ${table} live
    WHERE live.tenant_id = ${table}.tenant_id
      AND live.aggregate_id = ${table}.aggregate_id
      AND live.status IN ('pending','claimed'))`;
  return [
    {
      table,
      rule: `completed older than ${OUTBOX_COMPLETED_KEEP_DAYS} days`,
      where: `status = 'completed' AND updated_at < $1 AND ${notInFlight}`,
      params: [before(OUTBOX_COMPLETED_KEEP_DAYS)],
    },
    {
      table,
      rule: `dead older than ${OUTBOX_DEAD_KEEP_DAYS} days`,
      where: `status = 'dead' AND updated_at < $1 AND ${notInFlight}`,
      params: [before(OUTBOX_DEAD_KEEP_DAYS)],
    },
    {
      table,
      rule: `test environment, completed or dead, older than ${OUTBOX_TEST_KEEP_DAYS} days`,
      where: `environment = 'test' AND status IN ('completed','dead') AND updated_at < $1 AND ${notInFlight}`,
      params: [before(OUTBOX_TEST_KEEP_DAYS)],
    },
  ];
}

@Injectable()
export class TypeOrmOutboxRetention implements IOutboxRetention {
  private readonly logger = new Logger('OutboxRetention');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async purge(enabled: boolean, now: Date): Promise<void> {
    const options = this.dataSource.options;
    const schema = this.dataSource.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    // The nightly job is one: the outbox rules, then the notice rules (webhook deliveries and the
    // platform inboxes, in notice-retention.ts). Same dry run switch, same caps.
    const rules = [
      ...outboxRetentionRules(schema, now),
      ...noticeRetentionRules(schema, now),
    ];
    for (const rule of rules) {
      try {
        await runAsSystem('data_retention', () =>
          runRetentionRule(this.dataSource, rule, enabled, (outcome) =>
            this.logger.log({ event: 'data_retention', ...outcome }),
          ),
        );
      } catch (error) {
        this.logger.error({
          event: 'data_retention_failed',
          table: rule.table,
          rule: rule.rule,
          error: String(error),
        });
      }
    }
  }
}
