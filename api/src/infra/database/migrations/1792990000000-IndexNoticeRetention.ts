import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support the nightly notice cleanup (infra/retention/notice-retention.ts): finished rows by age. Both
 * are partial, so the pending and retrying rows the app reads all day stay out of them. The other
 * cleaned tables (webhook_events, integration_operations) are small, one row per payment or sale.
 * Plain CREATE INDEX, like the outbox one: no migration here uses `transaction = false`. The timestamp sits
 * before the NF-e migrations on purpose: their tests undo "the last N migrations" and count from the top.
 * It first shipped as 1793900000000 (same indexes), so a database that already ran that one keeps its
 * indexes: hence IF NOT EXISTS / IF EXISTS.
 */
export class IndexNoticeRetention1792990000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_finished ON ${s}.webhook_deliveries (created_at) WHERE status IN ('sent','failed')`,
    );
    await runner.query(
      `CREATE INDEX IF NOT EXISTS idx_integration_events_finished ON ${s}.integration_events (updated_at) WHERE state IN ('processed','ignored') AND payload_enc <> ''`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `DROP INDEX IF EXISTS ${s}.idx_integration_events_finished`,
    );
    await runner.query(
      `DROP INDEX IF EXISTS ${s}.idx_webhook_deliveries_finished`,
    );
  }
}
