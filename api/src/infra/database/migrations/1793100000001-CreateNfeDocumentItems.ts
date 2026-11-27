import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Items of an NF-e. Quantity has 4 decimals and the unit price 10, as the layout allows. */
export class CreateNfeDocumentItems1793100000001 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.nfe_document_items (
      document_id uuid NOT NULL,
      n_item smallint NOT NULL,
      tenant_id uuid NOT NULL,
      code varchar(60) NOT NULL,
      gtin varchar(14) NULL,
      description varchar(120) NOT NULL,
      ncm char(8) NOT NULL,
      cest char(7) NULL,
      cfop char(4) NOT NULL,
      unit varchar(6) NOT NULL,
      quantity numeric(15,4) NOT NULL,
      unit_price numeric(21,10) NOT NULL,
      total numeric(15,2) NOT NULL,
      discount numeric(15,2) NOT NULL DEFAULT 0,
      freight numeric(15,2) NOT NULL DEFAULT 0,
      insurance numeric(15,2) NOT NULL DEFAULT 0,
      other numeric(15,2) NOT NULL DEFAULT 0,
      origin smallint NOT NULL,
      csosn varchar(3) NOT NULL,
      pis_cst varchar(2) NOT NULL,
      cofins_cst varchar(2) NOT NULL,
      ibs_cbs jsonb NULL,
      PRIMARY KEY (document_id, n_item),
      CONSTRAINT fk_nfe_document_items_document FOREIGN KEY (document_id, tenant_id) REFERENCES ${s}.nfe_documents(id, tenant_id) ON DELETE CASCADE,
      CONSTRAINT ck_nfe_document_items_n_item CHECK (n_item BETWEEN 1 AND 990)
    )`);
    await runner.query(
      `CREATE INDEX idx_nfe_document_items_tenant ON ${s}.nfe_document_items (tenant_id)`,
    );
    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_items ENABLE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `ALTER TABLE ${s}.nfe_document_items FORCE ROW LEVEL SECURITY`,
    );
    await runner.query(
      `CREATE POLICY tenant_isolation_policy ON ${s}.nfe_document_items USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE ${this.schema(runner)}.nfe_document_items`);
  }
}
