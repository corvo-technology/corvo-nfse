import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `POST /v1/nfe/inutilizations` accepts an optional `Idempotency-Key`: the key and the hash of the
 * request are kept so a repeated request answers with the same inutilization.
 */
export class AddNfeInutilizationIdempotency1793300000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${s}.nfe_inutilizations ADD COLUMN idempotency_key varchar(200) NULL, ADD COLUMN request_hash char(64) NULL`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX uq_nfe_inutilizations_idempotency ON ${s}.nfe_inutilizations (tenant_id, environment, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`DROP INDEX ${s}.uq_nfe_inutilizations_idempotency`);
    await runner.query(
      `ALTER TABLE ${s}.nfe_inutilizations DROP COLUMN request_hash, DROP COLUMN idempotency_key`,
    );
  }
}
