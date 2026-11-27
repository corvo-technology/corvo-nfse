import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The NFC-e keeps its QR Code and `urlChave` (`infNFeSupl`) next to the signed XML. Null on an NF-e. */
export class AddNfceSupplementColumns1793610000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents ADD COLUMN qr_code text NULL, ADD COLUMN url_chave varchar(85) NULL`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const schema = this.schema(runner);
    await runner.query(
      `ALTER TABLE ${schema}.nfe_documents DROP COLUMN url_chave, DROP COLUMN qr_code`,
    );
  }
}
