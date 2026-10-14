import type { MigrationInterface, QueryRunner } from 'typeorm';
import { BASELINE_RLS_TABLES } from '../rls-tables';

const children = [
  ['nfse_certificates', 'company_id', 'nfse_companies'],
  ['nfse_dps_sequences', 'company_id', 'nfse_companies'],
  ['nfse_invoice_events', 'invoice_id', 'nfse_invoices'],
] as const;
export class EnableTenantRls1791750000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      (runner.connection.options as { schema?: string }).schema ?? 'corvo',
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const tenant = "current_setting('app.current_tenant_id', true)";
    for (const table of BASELINE_RLS_TABLES) {
      let owner = `${table === 'tenants' ? 'id' : 'tenant_id'}::text = ${tenant}`;
      const child = children.find(([name]) => name === table);
      if (child)
        owner = `EXISTS (SELECT 1 FROM ${schema}."${child[2]}" owner WHERE owner.id = "${table}"."${child[1]}" AND owner.tenant_id::text = ${tenant})`;
      await runner.query(
        `ALTER TABLE ${schema}."${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await runner.query(
        `ALTER TABLE ${schema}."${table}" FORCE ROW LEVEL SECURITY`,
      );
      await runner.query(
        `CREATE POLICY tenant_isolation_policy ON ${schema}."${table}" USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
      );
      if (table === 'tenant_memberships')
        await runner.query(
          `CREATE POLICY account_membership_read_policy ON ${schema}."${table}" FOR SELECT USING (auth_user_id::text = current_setting('app.current_auth_user_id', true))`,
        );
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    const schema = runner.connection.driver.escape(
      (runner.connection.options as { schema?: string }).schema ?? 'corvo',
    );
    for (const table of [...BASELINE_RLS_TABLES].reverse()) {
      if (table === 'tenant_memberships')
        await runner.query(
          `DROP POLICY account_membership_read_policy ON ${schema}."${table}"`,
        );
      await runner.query(
        `DROP POLICY tenant_isolation_policy ON ${schema}."${table}"`,
      );
      await runner.query(
        `ALTER TABLE ${schema}."${table}" NO FORCE ROW LEVEL SECURITY`,
      );
      await runner.query(
        `ALTER TABLE ${schema}."${table}" DISABLE ROW LEVEL SECURITY`,
      );
    }
  }
}
