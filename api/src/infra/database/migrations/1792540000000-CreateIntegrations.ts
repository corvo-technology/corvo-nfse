import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  'integration_connections',
  'integration_rules',
  'integration_operations',
  'integration_events',
];

export class CreateIntegrations1792540000000 implements MigrationInterface {
  private schema(runner: QueryRunner): string {
    const options = runner.connection.options;
    return runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
  }

  async up(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    await runner.query(`CREATE TABLE ${s}.integration_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES ${s}.tenants(id) ON DELETE CASCADE,
      company_id uuid NOT NULL REFERENCES ${s}.nfse_companies(id),
      public_id varchar(40) NOT NULL,
      provider varchar(40) NOT NULL,
      environment varchar(10) NOT NULL,
      external_account_id varchar(200),
      state varchar(20) NOT NULL DEFAULT 'draft',
      credentials_enc text NOT NULL,
      active_from timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_integration_connections_public_id UNIQUE (public_id),
      CONSTRAINT uq_integration_connections_id_tenant UNIQUE (id, tenant_id),
      CONSTRAINT ck_integration_connections_environment CHECK (environment IN ('test', 'live')),
      CONSTRAINT ck_integration_connections_state CHECK (state IN ('draft', 'active', 'paused', 'reauth_required', 'disconnected'))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_integration_connections_account ON ${s}.integration_connections (provider, environment, external_account_id) WHERE state <> 'disconnected' AND external_account_id IS NOT NULL`,
    );
    await runner.query(
      `CREATE INDEX idx_integration_connections_tenant ON ${s}.integration_connections (tenant_id)`,
    );

    await runner.query(`CREATE TABLE ${s}.integration_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      external_product_id varchar(200),
      service jsonb NOT NULL,
      send_email boolean NOT NULL DEFAULT false,
      allow_anonymous_customer boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_integration_rules_connection FOREIGN KEY (connection_id, tenant_id) REFERENCES ${s}.integration_connections (id, tenant_id) ON DELETE CASCADE
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_integration_rules_product ON ${s}.integration_rules (connection_id, COALESCE(external_product_id, ''))`,
    );

    await runner.query(`CREATE TABLE ${s}.integration_operations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      provider varchar(40) NOT NULL,
      environment varchar(10) NOT NULL,
      external_account_id varchar(200) NOT NULL,
      operation_key varchar(300) NOT NULL,
      commercial_state varchar(20) NOT NULL,
      fiscal_status varchar(20) NOT NULL DEFAULT 'none',
      block_reason varchar(60),
      snapshot jsonb NOT NULL,
      rule_id uuid,
      emission_request jsonb,
      emission_request_hash varchar(64),
      idempotency_key varchar(100),
      invoice_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_integration_operations_id_tenant UNIQUE (id, tenant_id),
      CONSTRAINT uq_integration_operations_key UNIQUE (tenant_id, environment, provider, external_account_id, operation_key),
      CONSTRAINT fk_integration_operations_connection FOREIGN KEY (connection_id, tenant_id) REFERENCES ${s}.integration_connections (id, tenant_id),
      CONSTRAINT ck_integration_operations_commercial CHECK (commercial_state IN ('pending', 'paid', 'refunded', 'disputed', 'canceled')),
      CONSTRAINT ck_integration_operations_fiscal CHECK (fiscal_status IN ('none', 'blocked', 'needs_attention', 'submitted'))
    )`);
    await runner.query(
      `CREATE INDEX idx_integration_operations_connection ON ${s}.integration_operations (connection_id, created_at DESC)`,
    );

    await runner.query(`CREATE TABLE ${s}.integration_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      connection_id uuid NOT NULL,
      provider varchar(40) NOT NULL,
      environment varchar(10) NOT NULL,
      external_account_id varchar(200) NOT NULL,
      delivery_id varchar(300) NOT NULL,
      external_type varchar(100) NOT NULL,
      payload_enc text NOT NULL,
      state varchar(20) NOT NULL DEFAULT 'received',
      attempts integer NOT NULL DEFAULT 0,
      claim_token uuid,
      locked_until timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text,
      operation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_integration_events_delivery UNIQUE (tenant_id, environment, provider, external_account_id, delivery_id),
      CONSTRAINT fk_integration_events_connection FOREIGN KEY (connection_id, tenant_id) REFERENCES ${s}.integration_connections (id, tenant_id),
      CONSTRAINT fk_integration_events_operation FOREIGN KEY (operation_id, tenant_id) REFERENCES ${s}.integration_operations (id, tenant_id),
      CONSTRAINT ck_integration_events_state CHECK (state IN ('received', 'processing', 'retry_pending', 'processed', 'ignored', 'needs_attention', 'dead'))
    )`);
    await runner.query(
      `CREATE INDEX idx_integration_events_due ON ${s}.integration_events (state, next_attempt_at)`,
    );
    await runner.query(
      `CREATE INDEX idx_integration_events_connection ON ${s}.integration_events (connection_id, created_at DESC)`,
    );

    const system = "current_setting('app.system_context', true) = 'on'";
    const owner =
      "tenant_id::text = current_setting('app.current_tenant_id', true)";
    for (const table of TABLES) {
      await runner.query(`ALTER TABLE ${s}.${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${s}.${table} FORCE ROW LEVEL SECURITY`);
      await runner.query(
        `CREATE POLICY tenant_isolation_policy ON ${s}.${table} USING (${owner} OR ${system}) WITH CHECK (${owner} OR ${system})`,
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const s = this.schema(runner);
    for (const table of [...TABLES].reverse())
      await runner.query(`DROP TABLE IF EXISTS ${s}.${table}`);
  }
}
