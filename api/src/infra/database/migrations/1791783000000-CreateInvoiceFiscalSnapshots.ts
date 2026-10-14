import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceFiscalSnapshots1791783000000
  implements MigrationInterface
{
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.invoice_fiscal_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id uuid NOT NULL REFERENCES ${s}.nfse_invoices(id) ON DELETE CASCADE,
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id) ON DELETE CASCADE,
      tax_regime varchar(20) NOT NULL,
      profile_id uuid NOT NULL,
      service_profile_id uuid,
      special_tax_regime varchar(50),
      attempt integer NOT NULL DEFAULT 1,
      calculation_version varchar(40) NOT NULL,
      gross_amount numeric(15,2) NOT NULL,
      discount_amount numeric(15,2) NOT NULL,
      iss_amount numeric(15,2),
      cbs_amount numeric(15,2),
      ibs_total_amount numeric(15,2),
      net_receivable_amount numeric(15,2) NOT NULL,
      result jsonb NOT NULL,
      calculated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_ifs_invoice_attempt UNIQUE (invoice_id, attempt),
      CONSTRAINT ck_ifs_tax_regime CHECK (tax_regime IN ('MEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','OUTRO_REGIME','UNKNOWN')),
      CONSTRAINT ck_ifs_attempt CHECK (attempt >= 1)
    )`);
    await runner.query(
      `CREATE INDEX idx_ifs_tenant ON ${s}.invoice_fiscal_snapshots (tenant_id)`,
    );
    await runner.query(
      `CREATE INDEX idx_ifs_company ON ${s}.invoice_fiscal_snapshots (company_id)`,
    );

    // A snapshot is an immutable audit record: any UPDATE or direct DELETE is a bug.
    // The only DELETE allowed is the one fired by the invoice's ON DELETE CASCADE
    // (an internal FK trigger, so trigger depth is already > 0 by the time the
    // row trigger runs).
    await runner.query(`CREATE FUNCTION ${s}.invoice_fiscal_snapshots_immutable()
      RETURNS trigger AS $fn$
      BEGIN
        IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'invoice_fiscal_snapshots is immutable';
      END;
      $fn$ LANGUAGE plpgsql`);
    await runner.query(
      `CREATE TRIGGER trg_invoice_fiscal_snapshots_immutable BEFORE UPDATE OR DELETE ON ${s}.invoice_fiscal_snapshots FOR EACH ROW EXECUTE FUNCTION ${s}.invoice_fiscal_snapshots_immutable()`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.invoice_fiscal_snapshots ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.invoice_fiscal_snapshots FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.invoice_fiscal_snapshots USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(
      `DROP TRIGGER IF EXISTS trg_invoice_fiscal_snapshots_immutable ON ${s}.invoice_fiscal_snapshots`,
    );
    await runner.query(
      `DROP FUNCTION IF EXISTS ${s}.invoice_fiscal_snapshots_immutable()`,
    );
    await runner.query(`DROP TABLE ${s}.invoice_fiscal_snapshots`);
  }
}
