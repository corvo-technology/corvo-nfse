/** Tables covered by the original RLS migration (1791750000000). Never change. */
export const BASELINE_RLS_TABLES = [
  'tenants',
  'tenant_billing',
  'tenant_settings',
  'tenant_memberships',
  'tenant_invitations',
  'api_keys',
  'nfse_companies',
  'nfse_invoices',
  'credit_transactions',
  'billing_usage_periods',
  'webhook_configs',
  'webhook_deliveries',
  'mcp_connections',
  'nfse_certificates',
  'nfse_dps_sequences',
  'nfse_invoice_events',
] as const;

/** Application tables whose tenant isolation must be enforced by PostgreSQL. */
export const TENANT_RLS_TABLES = [
  ...BASELINE_RLS_TABLES,
  'outbox_messages',
  'company_fiscal_profiles',
  'company_service_tax_profiles',
  'service_favorites',
  'product_favorites',
  'invoice_fiscal_snapshots',
  'invoice_fiscal_reconciliations',
  'integration_connections',
  'integration_rules',
  'integration_operations',
  'integration_events',
  'accountant_package_sends',
  'account_audit_events',
  'lifecycle_email_sends',
] as const;
