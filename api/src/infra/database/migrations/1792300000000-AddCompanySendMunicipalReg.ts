import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanySendMunicipalReg1792300000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    // The municipal registration is no longer sent in the DPS unless the company opts in:
    // the Receita rejects it (E0120) when the city has no complementary data for the provider.
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_companies
         ADD COLUMN IF NOT EXISTS send_municipal_reg boolean NOT NULL DEFAULT false`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.nfse_companies DROP COLUMN IF EXISTS send_municipal_reg`,
    );
  }
}
