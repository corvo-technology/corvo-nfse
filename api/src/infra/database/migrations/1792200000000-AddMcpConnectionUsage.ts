import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMcpConnectionUsage1792200000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.mcp_connections
         ADD COLUMN IF NOT EXISTS tool_calls_count integer NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS invoices_issued_count integer NOT NULL DEFAULT 0`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.mcp_connections
         DROP COLUMN IF EXISTS invoices_issued_count,
         DROP COLUMN IF EXISTS tool_calls_count`,
    );
  }
}
