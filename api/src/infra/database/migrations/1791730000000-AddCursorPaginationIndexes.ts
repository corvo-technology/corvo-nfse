import type { MigrationInterface, QueryRunner } from 'typeorm';
const indexes = [
  [
    'idx_companies_cursor',
    'nfse_companies',
    'tenant_id, environment, created_at DESC, id DESC',
    ' WHERE deleted_at IS NULL',
  ],
  [
    'idx_invoices_cursor',
    'nfse_invoices',
    'tenant_id, environment, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_invoice_events_cursor',
    'nfse_invoice_events',
    'invoice_id, created_at, id',
    '',
  ],
  [
    'idx_certificates_cursor',
    'nfse_certificates',
    'company_id, created_at DESC, id DESC',
    ' WHERE deleted_at IS NULL',
  ],
  [
    'idx_api_keys_cursor',
    'api_keys',
    'tenant_id, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_memberships_cursor',
    'tenant_memberships',
    'tenant_id, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_webhook_configs_cursor',
    'webhook_configs',
    'tenant_id, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_webhook_deliveries_cursor',
    'webhook_deliveries',
    'tenant_id, environment, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_credit_transactions_cursor',
    'credit_transactions',
    'tenant_id, created_at DESC, id DESC',
    '',
  ],
  [
    'idx_mcp_connections_cursor',
    'mcp_connections',
    'auth_user_id, tenant_id, granted_at DESC, id DESC',
    '',
  ],
  ['idx_plans_cursor', 'plans', 'monthly_credit_allowance, id', ''],
];
export class AddCursorPaginationIndexes1791730000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    for (const [name, table, columns, predicate] of indexes)
      await runner.query(
        `CREATE INDEX "${name}" ON ${schema}."${table}" (${columns})${predicate}`,
      );
  }
  async down(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    for (const [name] of [...indexes].reverse())
      await runner.query(`DROP INDEX ${schema}."${name}"`);
  }
}
