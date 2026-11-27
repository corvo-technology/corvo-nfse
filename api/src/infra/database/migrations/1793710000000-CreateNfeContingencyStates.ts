import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether the SVC (SEFAZ Virtual de Contingência) is in use for the NF-e of one UF in one
 * environment. The state is global, not the company's (the origin SEFAZ is down for everyone), so
 * there is no RLS, like `nfe_enabled_authorities`. No row means "none".
 */
export class CreateNfeContingencyStates1793710000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE ${this.schema(runner)}.nfe_contingency_states (
      uf char(2) NOT NULL,
      tp_amb smallint NOT NULL,
      mode varchar(10) NOT NULL DEFAULT 'none',
      entered_at timestamptz,
      dh_cont varchar(25),
      x_just varchar(256),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (uf, tp_amb),
      CONSTRAINT ck_nfe_contingency_states_tp_amb CHECK (tp_amb IN (1, 2)),
      CONSTRAINT ck_nfe_contingency_states_mode CHECK (mode IN ('none', 'svc'))
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE ${this.schema(runner)}.nfe_contingency_states`,
    );
  }
}
