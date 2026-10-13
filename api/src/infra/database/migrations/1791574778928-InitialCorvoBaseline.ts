import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialCorvoBaseline1791574778928 implements MigrationInterface {
  name = 'InitialCorvoBaseline1791574778928';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await queryRunner.query(
      `CREATE TABLE ${schema}."webhook_events" ("id" uuid NOT NULL, "provider" text NOT NULL, "provider_event_id" text NOT NULL, "event_type" text NOT NULL, "tenant_id" uuid, "resource_type" text, "external_resource_id" text, "processing_kind" text, "delivery_target" text, "payload" jsonb, "payload_sha256" text NOT NULL, "status" text NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "available_at" TIMESTAMP WITH TIME ZONE NOT NULL, "lease_until" TIMESTAMP WITH TIME ZONE, "last_error" text, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_webhook_events_payload_sha256" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'), CONSTRAINT "ck_webhook_events_attempts" CHECK ("attempts" >= 0), CONSTRAINT "ck_webhook_events_status" CHECK ("status" IN ('received', 'processing', 'processed', 'ignored', 'failed', 'manual_review')), CONSTRAINT "PK_4cba37e6a0acb5e1fc49c34ebfd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_provider_type_received" ON ${schema}."webhook_events" ("provider", "event_type", "received_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_tenant_received" ON ${schema}."webhook_events" ("tenant_id", "received_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_expired_lease" ON ${schema}."webhook_events" ("lease_until") WHERE "status" = 'processing' AND "lease_until" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_events_pending" ON ${schema}."webhook_events" ("status", "available_at", "received_at") WHERE "status" IN ('received', 'failed')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_webhook_events_provider_event" ON ${schema}."webhook_events" ("provider", "provider_event_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."tenants" ("id" uuid NOT NULL, "plan_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."tenant_memberships" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "auth_user_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "role" character varying(50) NOT NULL DEFAULT 'admin', "permissions" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_706d16104745b32d75df5836135" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tenant_memberships_auth_user_active" ON ${schema}."tenant_memberships" ("auth_user_id", "is_active", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tenant_memberships_tenant_active" ON ${schema}."tenant_memberships" ("tenant_id", "is_active") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_tenant_memberships_auth_user_tenant" ON ${schema}."tenant_memberships" ("auth_user_id", "tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."tenant_invitations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "email" character varying(255) NOT NULL, "name" character varying(100) NOT NULL, "role" character varying(50) NOT NULL DEFAULT 'admin', "permissions" text array NOT NULL DEFAULT '{}', "status" character varying(50) NOT NULL DEFAULT 'pending', "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_tenant_invitations_status" CHECK ("status" IN ('pending', 'completed', 'revoked', 'expired')), CONSTRAINT "PK_830d0f78b435fdcf23b84cc28da" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_tenant_invitations_pending_email" ON ${schema}."tenant_invitations" ("tenant_id", "email") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."tenant_billing" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "current_period_start" TIMESTAMP WITH TIME ZONE, "current_period_end" TIMESTAMP WITH TIME ZONE, "downgrade_to_plan_id" uuid, "billing_email" character varying(200), "billing_tax_id" character varying(20), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e99e574e7fa6d942c9ceed9f80d" UNIQUE ("tenant_id"), CONSTRAINT "PK_3adf5b4ad55795a97a1c8d122b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tenant_billing_tax_id" ON ${schema}."tenant_billing" ("billing_tax_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tenant_billing_email" ON ${schema}."tenant_billing" ("billing_email") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_users" ("id" uuid NOT NULL, "email" text NOT NULL, "name" text NOT NULL, "email_verified_at" TIMESTAMP WITH TIME ZONE, "primary_identity_type" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c88cc8077366b470dafc2917366" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_users_email" ON ${schema}."auth_users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_sessions" ("id" uuid NOT NULL, "auth_user_id" uuid NOT NULL, "client_id" text NOT NULL DEFAULT 'corvo-web', "kind" text NOT NULL DEFAULT 'oauth_refresh', "refresh_token_hash" text, "session_token_hash" text, "active_tenant_id" uuid, "revoked_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_auth_sessions_secret_kind" CHECK (("kind" = 'oauth_refresh' AND "refresh_token_hash" IS NOT NULL AND "session_token_hash" IS NULL) OR ("kind" = 'web' AND "session_token_hash" IS NOT NULL AND "refresh_token_hash" IS NULL)), CONSTRAINT "chk_auth_sessions_kind" CHECK ("kind" IN ('oauth_refresh', 'web')), CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_sessions_active_user_kind" ON ${schema}."auth_sessions" ("auth_user_id", "kind", "expires_at") WHERE "revoked_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_auth_sessions_one_active_web_per_user" ON ${schema}."auth_sessions" ("auth_user_id") WHERE "kind" = 'web' AND "revoked_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_sessions_client_id" ON ${schema}."auth_sessions" ("client_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_sessions_session_hash" ON ${schema}."auth_sessions" ("session_token_hash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_sessions_refresh_hash" ON ${schema}."auth_sessions" ("refresh_token_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_sessions_auth_user" ON ${schema}."auth_sessions" ("auth_user_id") `,
    );

    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_oauth_clients" ("id" text NOT NULL, "name" text NOT NULL, "redirect_uris" text array NOT NULL, "scopes" text array NOT NULL DEFAULT '{}', "is_first_party" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_16e623aeab02f6c8d86ba6b26ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_authorization_codes" ("id" uuid NOT NULL, "client_id" text NOT NULL, "auth_user_id" uuid NOT NULL, "product_key" text NOT NULL, "code_hash" text NOT NULL, "code_challenge" text NOT NULL, "code_challenge_method" text NOT NULL, "redirect_uri" text NOT NULL, "scope" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_auth_authorization_codes_challenge_method" CHECK ("code_challenge_method" IN ('S256')), CONSTRAINT "PK_c2ecb6968a63a751bd6fd2e2b6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_authorization_codes_client_user" ON ${schema}."auth_authorization_codes" ("client_id", "auth_user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_authorization_codes_code_hash" ON ${schema}."auth_authorization_codes" ("code_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_audit_events" ("id" uuid NOT NULL, "auth_user_id" uuid, "event_type" text NOT NULL, "client_id" text, "session_id" uuid, "ip_hash" text, "user_agent" text, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4ce7e89f8c00d8b6a81408713f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_audit_events_session_id" ON ${schema}."auth_audit_events" ("session_id") WHERE "session_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_audit_events_auth_user_created" ON ${schema}."auth_audit_events" ("auth_user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."webhook_deliveries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "webhook_config_id" uuid NOT NULL, "event_type" character varying(100) NOT NULL, "environment" character varying(10) NOT NULL DEFAULT 'live', "url" text NOT NULL, "payload" jsonb, "status_code" integer, "response_body" text, "error_message" text, "status" character varying(50) NOT NULL DEFAULT 'pending', "duration_ms" integer, "retry_count" integer NOT NULL DEFAULT '0', "next_retry_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_535dd409947fb6d8fc6dfc0112a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_deliveries_retry" ON ${schema}."webhook_deliveries" ("status", "next_retry_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_deliveries_tenant_created_at" ON ${schema}."webhook_deliveries" ("tenant_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."webhook_configs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "url" text NOT NULL, "events" text array NOT NULL, "secret" character varying(255) NOT NULL, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b6d2d3606e01c28d476122185b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_configs_tenant" ON ${schema}."webhook_configs" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."plans" ("id" uuid NOT NULL, "slug" character varying(20) NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "monthly_credit_allowance" integer NOT NULL DEFAULT '0', "daily_limit" integer, "max_active_companies" integer NOT NULL DEFAULT '1', "credit_unit_price_cents" integer NOT NULL DEFAULT '0', "throughput_rps" integer NOT NULL DEFAULT '10', "includes_webhooks" boolean NOT NULL DEFAULT true, "includes_xml_download" boolean NOT NULL DEFAULT true, "includes_pdf_download" boolean NOT NULL DEFAULT true, "includes_api_keys" boolean NOT NULL DEFAULT true, "support_tier" character varying(20) NOT NULL DEFAULT 'community', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e7b71bb444e74ee067df057397e" UNIQUE ("slug"), CONSTRAINT "ck_plans_support_tier" CHECK ("support_tier" IN ('community', 'email', 'priority')), CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."nfse_invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "external_id" character varying(100), "idempotency_key" character varying(255), "status" character varying(30) NOT NULL, "customer_snapshot" jsonb NOT NULL, "service_snapshot" jsonb NOT NULL, "tax_snapshot" jsonb NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'BRL', "competence_date" date NOT NULL, "dps_id" character varying(50), "dps_series" character varying(10), "dps_number" bigint, "access_key" character varying(60), "nfse_number" bigint, "fiscal_provider" character varying(30) NOT NULL DEFAULT 'national', "fiscal_schema_version" character varying(20) NOT NULL DEFAULT 'v2_02', "issued_at" TIMESTAMP WITH TIME ZONE, "authorized_at" TIMESTAMP WITH TIME ZONE, "last_error_code" character varying(50), "last_error_message" text, "last_error_provider" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_66c9cb1944db6edf8c1d5659b0b" UNIQUE ("idempotency_key"), CONSTRAINT "ck_nfse_invoices_status" CHECK ("status" IN ('queued', 'processing', 'authorized', 'rejected', 'retry_pending', 'reconciliation_required', 'manual_review', 'failed')), CONSTRAINT "PK_04e12513c2bf2d8b7c0f27a672a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nfse_invoices_tenant_created_at" ON ${schema}."nfse_invoices" ("tenant_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nfse_invoices_company_status" ON ${schema}."nfse_invoices" ("company_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."nfse_invoice_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "invoice_id" uuid NOT NULL, "from_status" character varying(30), "to_status" character varying(30) NOT NULL, "reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_993141e664998cac5a1edef05df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nfse_invoice_events_invoice_created_at" ON ${schema}."nfse_invoice_events" ("invoice_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."nfse_dps_sequences" ("company_id" uuid NOT NULL, "series" character varying(10) NOT NULL DEFAULT 'U', "current_number" bigint NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0774524d21e0e8d7ecbaa9884d1" PRIMARY KEY ("company_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."credit_transactions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "amount" integer NOT NULL, "type" character varying(50) NOT NULL, "description" text, "stripe_session_id" character varying(255), "metadata" jsonb, "amount_brl_cents" integer, "unit_price_cents_applied" integer, "plan_id_snapshot" uuid, "source" character varying(20), "channel_slug" character varying(20), "reserved_invoice_id" uuid, "period_id" uuid, "is_reservation" boolean NOT NULL DEFAULT false, "related_transaction_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a408319811d1ab32832ec86fc2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_transactions_reservation" ON ${schema}."credit_transactions" ("reserved_invoice_id") WHERE "is_reservation" = true`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_credit_transactions_tenant_created_at" ON ${schema}."credit_transactions" ("tenant_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."nfse_companies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "legal_name" character varying(200) NOT NULL, "trade_name" character varying(200), "tax_id" character varying(20) NOT NULL, "municipal_reg" character varying(20), "municipality_code" character varying(7), "tax_regime" character varying(30) NOT NULL, "simple_national" boolean NOT NULL DEFAULT false, "special_regime" character varying(50), "address_street" character varying(200), "address_number" character varying(20), "address_complement" character varying(100), "address_district" character varying(100), "address_city" character varying(100), "address_state" character(2), "address_zip" character varying(10), "fiscal_schema_version" character varying(20) NOT NULL DEFAULT 'v2_02', "environment" character varying(10) NOT NULL DEFAULT 'sandbox', "status" character varying(30) NOT NULL DEFAULT 'pending_setup', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_nfse_companies_environment" CHECK ("environment" IN ('sandbox', 'production')), CONSTRAINT "ck_nfse_companies_status" CHECK ("status" IN ('pending_setup', 'ready', 'blocked')), CONSTRAINT "PK_b42b1a9ba47e7ace531236b9376" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_nfse_companies_tenant_tax_id" ON ${schema}."nfse_companies" ("tenant_id", "tax_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nfse_companies_tenant" ON ${schema}."nfse_companies" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."nfse_certificates" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL, "serial_number" character varying(100) NOT NULL, "issuer" character varying(500) NOT NULL, "subject" character varying(500) NOT NULL, "fingerprint" character varying(100) NOT NULL, "valid_from" TIMESTAMP WITH TIME ZONE NOT NULL, "valid_until" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "encrypted_blob" bytea NOT NULL, "encrypted_dek" bytea NOT NULL, "dek_iv" bytea NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_nfse_certificates_status" CHECK ("status" IN ('active', 'expired', 'revoked')), CONSTRAINT "PK_3599e4949b30f6e84e248e96858" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_nfse_certificates_company_active" ON ${schema}."nfse_certificates" ("company_id") WHERE "status" = 'active' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_nfse_certificates_company_status" ON ${schema}."nfse_certificates" ("company_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."tenant_settings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "timezone" character varying(50) NOT NULL DEFAULT 'UTC', "business_hours_start" integer NOT NULL DEFAULT '9', "business_hours_end" integer NOT NULL DEFAULT '18', "business_days" integer array NOT NULL DEFAULT '{1,2,3,4,5}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a6abc1c3ed0df635955fc852f1c" UNIQUE ("tenant_id"), CONSTRAINT "PK_69225c0ca64bcbbf9af8a217043" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."auth_identities" ("id" uuid NOT NULL, "auth_user_id" uuid NOT NULL, "provider" text NOT NULL, "provider_user_id" text, "email" text NOT NULL, "email_verified" boolean NOT NULL DEFAULT false, "name" text, "avatar_url" text, "access_token_encrypted" text, "refresh_token_encrypted" text, "metadata" jsonb, "linked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_auth_identities_provider" CHECK ("provider" IN ('github', 'google', 'email')), CONSTRAINT "PK_63a29aebcddd09448dbeee4666b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_identities_auth_user_id" ON ${schema}."auth_identities" ("auth_user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_identities_provider_user_id" ON ${schema}."auth_identities" ("provider", "provider_user_id") WHERE "provider_user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_auth_identities_user_provider" ON ${schema}."auth_identities" ("auth_user_id", "provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_identities_email" ON ${schema}."auth_identities" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${schema}."api_keys" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "environment" character varying(10) NOT NULL DEFAULT 'live', "key_prefix" character varying(64) NOT NULL, "key_hash" character varying(255) NOT NULL, "scope" character varying(50) NOT NULL, "last_used_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_b99bbb8e545065a99b409dbc5d8" UNIQUE ("key_prefix"), CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_api_keys_tenant" ON ${schema}."api_keys" ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenants" ADD CONSTRAINT "fk_tenants_plan" FOREIGN KEY ("plan_id") REFERENCES ${schema}."plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_memberships" ADD CONSTRAINT "fk_tenant_memberships_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_memberships" ADD CONSTRAINT "fk_tenant_memberships_auth_user" FOREIGN KEY ("auth_user_id") REFERENCES ${schema}."auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_invitations" ADD CONSTRAINT "fk_tenant_invitations_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_billing" ADD CONSTRAINT "fk_tenant_billing_downgrade" FOREIGN KEY ("downgrade_to_plan_id") REFERENCES ${schema}."plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_billing" ADD CONSTRAINT "fk_tenant_billing_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_sessions" ADD CONSTRAINT "fk_auth_sessions_client" FOREIGN KEY ("client_id") REFERENCES ${schema}."auth_oauth_clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_sessions" ADD CONSTRAINT "fk_auth_sessions_user" FOREIGN KEY ("auth_user_id") REFERENCES ${schema}."auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_authorization_codes" ADD CONSTRAINT "fk_auth_authorization_codes_client" FOREIGN KEY ("client_id") REFERENCES ${schema}."auth_oauth_clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_authorization_codes" ADD CONSTRAINT "fk_auth_authorization_codes_user" FOREIGN KEY ("auth_user_id") REFERENCES ${schema}."auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_audit_events" ADD CONSTRAINT "fk_auth_audit_events_session" FOREIGN KEY ("session_id") REFERENCES ${schema}."auth_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_audit_events" ADD CONSTRAINT "fk_auth_audit_events_user" FOREIGN KEY ("auth_user_id") REFERENCES ${schema}."auth_users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_config" FOREIGN KEY ("webhook_config_id") REFERENCES ${schema}."webhook_configs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_configs" ADD CONSTRAINT "fk_webhook_configs_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" ADD CONSTRAINT "fk_nfse_invoices_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" ADD CONSTRAINT "fk_nfse_invoices_company" FOREIGN KEY ("company_id") REFERENCES ${schema}."nfse_companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoice_events" ADD CONSTRAINT "fk_nfse_invoice_events_invoice" FOREIGN KEY ("invoice_id") REFERENCES ${schema}."nfse_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_dps_sequences" ADD CONSTRAINT "fk_nfse_dps_sequences_company" FOREIGN KEY ("company_id") REFERENCES ${schema}."nfse_companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."credit_transactions" ADD CONSTRAINT "fk_credit_transactions_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_companies" ADD CONSTRAINT "fk_nfse_companies_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_certificates" ADD CONSTRAINT "fk_nfse_certificates_company" FOREIGN KEY ("company_id") REFERENCES ${schema}."nfse_companies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_settings" ADD CONSTRAINT "fk_tenant_settings_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_identities" ADD CONSTRAINT "fk_auth_identities_user" FOREIGN KEY ("auth_user_id") REFERENCES ${schema}."auth_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."api_keys" ADD CONSTRAINT "fk_api_keys_tenant" FOREIGN KEY ("tenant_id") REFERENCES ${schema}."tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // First-party session client plus the existing social OAuth clients.
    await queryRunner.query(`
          INSERT INTO ${schema}."auth_oauth_clients"
            (id, name, redirect_uris, scopes, is_first_party, is_active)
          VALUES
            ('corvo-web', 'Corvo Web', ARRAY['http://localhost:5173/auth/callback', 'http://localhost:3000/auth/callback'], ARRAY['openid', 'profile', 'email'], true, true),
            ('github-client', 'GitHub OAuth', ARRAY['http://localhost:3000/auth/callback/github'], ARRAY['read:user', 'user:email'], true, true),
            ('google-client', 'Google OAuth', ARRAY['http://localhost:3000/auth/callback/google'], ARRAY['openid', 'email', 'profile'], true, true)
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(
      `ALTER TABLE ${schema}."api_keys" DROP CONSTRAINT "fk_api_keys_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_identities" DROP CONSTRAINT "fk_auth_identities_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_settings" DROP CONSTRAINT "fk_tenant_settings_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_certificates" DROP CONSTRAINT "fk_nfse_certificates_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_companies" DROP CONSTRAINT "fk_nfse_companies_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."credit_transactions" DROP CONSTRAINT "fk_credit_transactions_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_dps_sequences" DROP CONSTRAINT "fk_nfse_dps_sequences_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoice_events" DROP CONSTRAINT "fk_nfse_invoice_events_invoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" DROP CONSTRAINT "fk_nfse_invoices_company"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."nfse_invoices" DROP CONSTRAINT "fk_nfse_invoices_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_configs" DROP CONSTRAINT "fk_webhook_configs_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_deliveries" DROP CONSTRAINT "fk_webhook_deliveries_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."webhook_deliveries" DROP CONSTRAINT "fk_webhook_deliveries_config"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_audit_events" DROP CONSTRAINT "fk_auth_audit_events_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_audit_events" DROP CONSTRAINT "fk_auth_audit_events_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_authorization_codes" DROP CONSTRAINT "fk_auth_authorization_codes_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_authorization_codes" DROP CONSTRAINT "fk_auth_authorization_codes_client"`,
    );

    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_sessions" DROP CONSTRAINT "fk_auth_sessions_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."auth_sessions" DROP CONSTRAINT "fk_auth_sessions_client"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_billing" DROP CONSTRAINT "fk_tenant_billing_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_billing" DROP CONSTRAINT "fk_tenant_billing_downgrade"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_invitations" DROP CONSTRAINT "fk_tenant_invitations_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_memberships" DROP CONSTRAINT "fk_tenant_memberships_auth_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenant_memberships" DROP CONSTRAINT "fk_tenant_memberships_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${schema}."tenants" DROP CONSTRAINT "fk_tenants_plan"`,
    );
    await queryRunner.query(`DROP INDEX ${schema}."idx_api_keys_tenant"`);
    await queryRunner.query(`DROP TABLE ${schema}."api_keys"`);
    await queryRunner.query(`DROP INDEX ${schema}."idx_auth_identities_email"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_identities_user_provider"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_identities_provider_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_identities_auth_user_id"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."auth_identities"`);
    await queryRunner.query(`DROP TABLE ${schema}."tenant_settings"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_certificates_company_status"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_certificates_company_active"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."nfse_certificates"`);
    await queryRunner.query(`DROP INDEX ${schema}."idx_nfse_companies_tenant"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_companies_tenant_tax_id"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."nfse_companies"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_credit_transactions_tenant_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_credit_transactions_reservation"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."credit_transactions"`);
    await queryRunner.query(`DROP TABLE ${schema}."nfse_dps_sequences"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_invoice_events_invoice_created_at"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."nfse_invoice_events"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_invoices_company_status"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_nfse_invoices_tenant_created_at"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."nfse_invoices"`);
    await queryRunner.query(`DROP TABLE ${schema}."plans"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_configs_tenant"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."webhook_configs"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_deliveries_tenant_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_deliveries_retry"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."webhook_deliveries"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_audit_events_auth_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_audit_events_session_id"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."auth_audit_events"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_authorization_codes_code_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_authorization_codes_client_user"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."auth_authorization_codes"`);
    await queryRunner.query(`DROP TABLE ${schema}."auth_oauth_clients"`);

    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_sessions_auth_user"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_sessions_refresh_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_sessions_session_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_sessions_client_id"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."uq_auth_sessions_one_active_web_per_user"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_auth_sessions_active_user_kind"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."auth_sessions"`);
    await queryRunner.query(`DROP INDEX ${schema}."idx_auth_users_email"`);
    await queryRunner.query(`DROP TABLE ${schema}."auth_users"`);
    await queryRunner.query(`DROP INDEX ${schema}."idx_tenant_billing_email"`);
    await queryRunner.query(`DROP INDEX ${schema}."idx_tenant_billing_tax_id"`);
    await queryRunner.query(`DROP TABLE ${schema}."tenant_billing"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_tenant_invitations_pending_email"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."tenant_invitations"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_tenant_memberships_auth_user_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_tenant_memberships_tenant_active"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_tenant_memberships_auth_user_active"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."tenant_memberships"`);
    await queryRunner.query(`DROP TABLE ${schema}."tenants"`);
    await queryRunner.query(
      `DROP INDEX ${schema}."uq_webhook_events_provider_event"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_events_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_events_expired_lease"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_events_tenant_received"`,
    );
    await queryRunner.query(
      `DROP INDEX ${schema}."idx_webhook_events_provider_type_received"`,
    );
    await queryRunner.query(`DROP TABLE ${schema}."webhook_events"`);
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
