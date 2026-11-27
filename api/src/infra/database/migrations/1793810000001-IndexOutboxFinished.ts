import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports the daily outbox purge (finished rows by age). Partial, so it holds only completed and dead
 * rows and costs nothing for the hot pending/claimed rows. A plain CREATE INDEX: no migration here
 * uses `transaction = false`, and the table is small enough to index in a moment at deploy.
 */
export class IndexOutboxFinished1793810000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `CREATE INDEX idx_outbox_finished_updated ON ${this.schema(runner)}.outbox_messages (updated_at) WHERE status IN ('completed','dead')`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP INDEX ${this.schema(runner)}.idx_outbox_finished_updated`,
    );
  }
}
