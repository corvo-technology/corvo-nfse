// src/infra/database/migrations/1791590400000-McpoauthServerBaseline.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class McpoauthServerBaseline1791590400000 implements MigrationInterface {
  name = 'McpoauthServerBaseline1791590400000';

  public async up(qr: QueryRunner): Promise<void> {
    const schema = this.schema(qr);
    // 1. Extend auth_oauth_clients
    await qr.query(`
      ALTER TABLE ${schema}."auth_oauth_clients"
        ADD COLUMN IF NOT EXISTS "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS "grant_types" TEXT[] NOT NULL DEFAULT ARRAY['authorization_code'];
    `);

    // 2. Extend auth_authorization_codes
    await qr.query(`
      ALTER TABLE ${schema}."auth_authorization_codes"
        ADD COLUMN IF NOT EXISTS "tenant_id" UUID;
    `);

    // 3. Create mcp_connections
    await qr.query(`
      CREATE TABLE IF NOT EXISTS ${schema}."mcp_connections" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "auth_user_id"   UUID NOT NULL REFERENCES ${schema}."auth_users"("id") ON DELETE CASCADE,
        "tenant_id"      UUID NOT NULL REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE,
        "client_id"      TEXT NOT NULL REFERENCES ${schema}."auth_oauth_clients"("id"),
        "session_id"     UUID NOT NULL REFERENCES ${schema}."auth_sessions"("id") ON DELETE CASCADE,
        "scopes"         TEXT[] NOT NULL,
        "granted_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "revoked_at"     TIMESTAMPTZ,
        "last_used_at"   TIMESTAMPTZ,
        CONSTRAINT "mcp_connections_auth_user_tenant_uniq"
          UNIQUE ("auth_user_id", "tenant_id", "client_id")
      );
      CREATE INDEX IF NOT EXISTS "idx_mcp_connections_auth_user_id" ON ${schema}."mcp_connections"("auth_user_id");
      CREATE INDEX IF NOT EXISTS "idx_mcp_connections_tenant_id" ON ${schema}."mcp_connections"("tenant_id");
    `);

    // 4. Update auth_identities provider CHECK
    await qr.query(`
      ALTER TABLE ${schema}."auth_identities" DROP CONSTRAINT "ck_auth_identities_provider";
      ALTER TABLE ${schema}."auth_identities" ADD CONSTRAINT "ck_auth_identities_provider"
        CHECK ("provider" IN ('github', 'google', 'email', 'mcp'));
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    const schema = this.schema(qr);
    await qr.query(`DROP TABLE IF EXISTS ${schema}."mcp_connections";`);
    await qr.query(
      `ALTER TABLE ${schema}."auth_authorization_codes" DROP COLUMN IF EXISTS "tenant_id";`,
    );
    await qr.query(
      `ALTER TABLE ${schema}."auth_oauth_clients" DROP COLUMN IF EXISTS "token_endpoint_auth_method";`,
    );
    await qr.query(
      `ALTER TABLE ${schema}."auth_oauth_clients" DROP COLUMN IF EXISTS "grant_types";`,
    );
    await qr.query(`
      ALTER TABLE ${schema}."auth_identities" DROP CONSTRAINT "ck_auth_identities_provider";
      ALTER TABLE ${schema}."auth_identities" ADD CONSTRAINT "ck_auth_identities_provider"
        CHECK ("provider" IN ('github', 'google', 'email'));
    `);
  }

  private schema(queryRunner: QueryRunner): string {
    const options = queryRunner.connection.options;
    const name = 'schema' in options ? (options.schema ?? 'corvo') : 'corvo';
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
      throw new Error('Invalid PostgreSQL schema name');
    }
    return queryRunner.connection.driver.escape(name);
  }
}
