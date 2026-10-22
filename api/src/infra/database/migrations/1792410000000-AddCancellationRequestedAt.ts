import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancellationRequestedAt1792410000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_invoices
         ADD COLUMN cancellation_requested_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_invoices
         DROP COLUMN cancellation_requested_at`,
    );
  }
}
