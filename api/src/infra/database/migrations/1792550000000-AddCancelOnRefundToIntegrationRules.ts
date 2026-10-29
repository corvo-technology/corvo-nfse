import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelOnRefundToIntegrationRules1792550000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.integration_rules ADD COLUMN cancel_on_refund boolean NOT NULL DEFAULT false`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.integration_rules DROP COLUMN cancel_on_refund`,
    );
  }
}
