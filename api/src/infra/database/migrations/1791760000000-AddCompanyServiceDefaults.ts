import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyServiceDefaults1791760000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies ADD COLUMN default_service_code varchar(6)`,
    );
    // Preserve legacy data; companies without a municipality must finish setup.
    await runner.query(`UPDATE ${schema}.nfse_companies
      SET status = 'pending_setup', updated_at = now()
      WHERE status = 'ready' AND (municipality_code IS NULL OR municipality_code !~ '^[0-9]{7}$')`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies DROP COLUMN default_service_code`,
    );
  }
}
