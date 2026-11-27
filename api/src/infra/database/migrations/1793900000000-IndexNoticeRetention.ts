import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support the nightly notice cleanup (infra/retention/notice-retention.ts): finished rows by age. Both
 * are partial, so the pending and retrying rows the app reads all day stay out of them. The other
 * cleaned tables (webhook_events, integration_operations) are small, one row per payment or sale.
 * Plain CREATE INDEX, like the outbox one: no migration here uses `transaction = false`.
 */
export class IndexNoticeRetention1793900000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `CREATE INDEX idx_webhook_deliveries_finished ON ${s}.webhook_deliveries (created_at) WHERE status IN ('sent','failed')`,
    );
    await runner.query(
      `CREATE INDEX idx_integration_events_finished ON ${s}.integration_events (updated_at) WHERE state IN ('processed','ignored') AND payload_enc <> ''`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.idx_integration_events_finished`);
    await runner.query(`DROP INDEX ${s}.idx_webhook_deliveries_finished`);
  }
}
