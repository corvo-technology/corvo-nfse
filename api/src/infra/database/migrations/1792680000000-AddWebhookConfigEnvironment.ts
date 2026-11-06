import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Webhook endpoints created with an API key belong to that key's environment. Older endpoints and
 * endpoints created from the dashboard keep NULL, which still means "both environments".
 */
export class AddWebhookConfigEnvironment1792680000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.webhook_configs ADD COLUMN environment varchar(8) NULL`,
    );
    await runner.query(
      `ALTER TABLE ${s}.webhook_configs ADD CONSTRAINT chk_webhook_configs_environment CHECK (environment IN ('test', 'live'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.webhook_configs DROP CONSTRAINT chk_webhook_configs_environment`,
    );
    await runner.query(
      `ALTER TABLE ${s}.webhook_configs DROP COLUMN environment`,
    );
  }
}
