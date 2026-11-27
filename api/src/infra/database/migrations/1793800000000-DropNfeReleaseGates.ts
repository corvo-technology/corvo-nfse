import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NF-e and NFC-e are open to every workspace in test, so the three release gates go away: the
 * per-tenant release (`tenants.nfe_enabled_at`, `tenants.nfce_enabled_at`) and the table of released
 * UFs (`nfe_enabled_authorities`). Nothing reads them any more. `down()` brings back the structure,
 * not the old data (every release was a manual choice that no longer has a meaning).
 */
export class DropNfeReleaseGates1793800000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.tenants DROP COLUMN IF EXISTS nfe_enabled_at`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.tenants DROP COLUMN IF EXISTS nfce_enabled_at`,
    );
    await runner.query(
      `DROP TABLE IF EXISTS ${schema}.nfe_enabled_authorities`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.tenants ADD COLUMN IF NOT EXISTS nfe_enabled_at timestamptz NULL`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.tenants ADD COLUMN IF NOT EXISTS nfce_enabled_at timestamptz NULL`,
    );
    await runner.query(`CREATE TABLE IF NOT EXISTS ${schema}.nfe_enabled_authorities (
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
}
