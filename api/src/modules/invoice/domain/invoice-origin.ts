/**
 * Where an invoice came from. The invoice stores no origin column: it is read from the
 * idempotency key Corvo itself writes (`integ_`, `schedule:`, `import:`) and from the
 * `dashboard-` reference the web app sends. Everything else was sent by a client.
 */
export const INVOICE_ORIGINS = [
  'dashboard',
  'api',
  'integration',
  'schedule',
  'import',
] as const;
export type InvoiceOrigin = (typeof INVOICE_ORIGINS)[number];

export const ORIGIN_KEY_PREFIX = {
  integration: 'integ_',
  schedule: 'schedule:',
  import: 'import:',
} as const;
export const DASHBOARD_REFERENCE_PREFIX = 'dashboard-';

export function originOf(invoice: {
  idempotencyKey?: string | null;
  externalId?: string | null;
}): InvoiceOrigin {
  const key = invoice.idempotencyKey ?? '';
  if (key.startsWith(ORIGIN_KEY_PREFIX.integration)) return 'integration';
  if (key.startsWith(ORIGIN_KEY_PREFIX.schedule)) return 'schedule';
  if (key.startsWith(ORIGIN_KEY_PREFIX.import)) return 'import';
  if (invoice.externalId?.startsWith(DASHBOARD_REFERENCE_PREFIX))
    return 'dashboard';
  return 'api';
}
