import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMcpEnvironment1792210000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    // The user picks test or live on the consent screen; existing connections stay on test.
    await runner.query(
      `ALTER TABLE ${schema}.mcp_connections
         ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test'`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.mcp_connections
         ADD CONSTRAINT chk_mcp_connections_environment CHECK (environment IN ('test', 'live'))`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.auth_authorization_codes
         ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test'`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.auth_authorization_codes DROP COLUMN IF EXISTS environment`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.mcp_connections
         DROP CONSTRAINT IF EXISTS chk_mcp_connections_environment,
         DROP COLUMN IF EXISTS environment`,
    );
  }
}
