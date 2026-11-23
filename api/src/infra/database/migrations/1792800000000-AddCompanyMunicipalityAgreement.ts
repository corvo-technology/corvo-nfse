import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Last answer of the Sefin about the company's municipality agreement (`consultarConvenio`) and when it was asked.
 * Both are null until the first check, which needs the company certificate.
 */
export class AddCompanyMunicipalityAgreement1792800000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies ADD COLUMN municipality_agreement jsonb, ADD COLUMN municipality_agreement_checked_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies DROP COLUMN municipality_agreement_checked_at, DROP COLUMN municipality_agreement`,
    );
  }
}
