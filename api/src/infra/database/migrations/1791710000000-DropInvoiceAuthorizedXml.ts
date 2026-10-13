import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * The authorized NFS-e XML lives only in document storage (S3). Run
 * nfse-doc-prep for authorized invoices that still have no stored XML before
 * applying this in an environment with real data.
 */
export class DropInvoiceAuthorizedXml1791710000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices DROP COLUMN IF EXISTS authorized_xml`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN IF NOT EXISTS authorized_xml text`,
    );
  }
}
