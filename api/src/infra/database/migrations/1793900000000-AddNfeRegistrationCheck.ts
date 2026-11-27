import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The last conclusive answer of the SEFAZ "Consulta Cadastro" about the IE of the company, to stop a note the SEFAZ would refuse. */
export class AddNfeRegistrationCheck1793900000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.company_nfe_settings
         ADD COLUMN registration_check_status varchar(20),
         ADD COLUMN registration_check_ie varchar(14),
         ADD COLUMN registration_checked_at timestamptz`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE ${this.schema(runner)}.company_nfe_settings
         DROP COLUMN registration_check_status,
         DROP COLUMN registration_check_ie,
         DROP COLUMN registration_checked_at`,
    );
  }
}
