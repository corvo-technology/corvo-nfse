import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UF x model x environment combinations that passed the homologation roteiro. Global data (no RLS)
 * and no seed: releasing a UF is inserting a row after the roteiro, never a code change.
 */
export class CreateNfeEnabledAuthorities1793000000003 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE ${this.schema(runner)}.nfe_enabled_authorities (
      uf char(2) NOT NULL,
      model smallint NOT NULL,
      tp_amb smallint NOT NULL,
      enabled_at timestamptz NOT NULL,
      runbook_ref text NOT NULL,
      PRIMARY KEY (uf, model, tp_amb),
      CONSTRAINT ck_nfe_enabled_authorities_model CHECK (model IN (55, 65)),
      CONSTRAINT ck_nfe_enabled_authorities_tp_amb CHECK (tp_amb IN (1, 2))
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.nfe_enabled_authorities`,
    );
  }
}
