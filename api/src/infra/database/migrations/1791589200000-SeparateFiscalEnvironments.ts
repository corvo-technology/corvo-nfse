import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class SeparateFiscalEnvironments1791589200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies DROP CONSTRAINT ck_nfse_companies_environment`,
    );
    await runner.query(
      `UPDATE ${schema}.nfse_companies SET environment = CASE environment WHEN 'sandbox' THEN 'test' WHEN 'production' THEN 'live' ELSE environment END`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_companies ALTER COLUMN environment SET DEFAULT 'test', ADD CONSTRAINT ck_nfse_companies_environment CHECK (environment IN ('test','live'))`,
    );
    await runner.query(`DROP INDEX ${schema}.idx_nfse_companies_tenant_tax_id`);
    await runner.query(
      `CREATE UNIQUE INDEX idx_nfse_companies_tenant_tax_id ON ${schema}.nfse_companies(tenant_id,environment,tax_id) WHERE deleted_at IS NULL`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD COLUMN document_key_version integer NOT NULL DEFAULT 1, ADD COLUMN environment varchar(10), ADD COLUMN request_hash varchar(64), ADD COLUMN email_snapshot jsonb, ADD COLUMN authorized_xml text, ADD COLUMN pending_emission jsonb`,
    );
    await runner.query(
      `UPDATE ${schema}.nfse_invoices i SET environment = c.environment FROM ${schema}.nfse_companies c WHERE c.id = i.company_id`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ALTER COLUMN document_key_version SET DEFAULT 2, ALTER COLUMN environment SET NOT NULL, ALTER COLUMN environment SET DEFAULT 'test', ADD CONSTRAINT ck_nfse_invoices_environment CHECK (environment IN ('test','live'))`,
    );
    const table = await runner.getTable(
      `${'schema' in options ? (options.schema ?? 'corvo') : 'corvo'}.nfse_invoices`,
    );
    for (const unique of table?.uniques ?? []) {
      if (
        unique.columnNames.length === 1 &&
        unique.columnNames[0] === 'idempotency_key'
      )
        await runner.dropUniqueConstraint(table!, unique);
    }
    await runner.query(
      `CREATE UNIQUE INDEX idx_nfse_invoices_idempotency ON ${schema}.nfse_invoices(tenant_id,environment,idempotency_key)`,
    );
    await runner.query(
      `CREATE INDEX idx_nfse_invoices_environment_created ON ${schema}.nfse_invoices(tenant_id,environment,created_at)`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX idx_credit_invoice_debit ON ${schema}.credit_transactions(reserved_invoice_id) WHERE reserved_invoice_id IS NOT NULL`,
    );
    await runner.query(
      `CREATE UNIQUE INDEX idx_credit_invoice_refund ON ${schema}.credit_transactions(related_transaction_id) WHERE type = 'invoice_rejected'`,
    );
    await runner.query(
      `UPDATE ${schema}.nfse_dps_sequences SET series = '1' WHERE series = 'U'`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_dps_sequences ALTER COLUMN series SET DEFAULT '1'`,
    );
    // Enforce the tenant and environment association even for internal writes.
    await runner.query(
      `CREATE UNIQUE INDEX idx_company_execution_identity ON ${schema}.nfse_companies(id,tenant_id,environment)`,
    );
    await runner.query(
      `ALTER TABLE ${schema}.nfse_invoices ADD CONSTRAINT fk_invoice_execution_company FOREIGN KEY(company_id,tenant_id,environment) REFERENCES ${schema}.nfse_companies(id,tenant_id,environment)`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async down(): Promise<void> {
    throw new Error(
      'Environment separation cannot be reverted automatically: test/live may share CNPJs and idempotency keys. Restore a backup instead.',
    );
  }
}
