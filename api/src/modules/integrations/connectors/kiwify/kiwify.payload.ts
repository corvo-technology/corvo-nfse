import { parseCustomerTaxId } from '@/shared/tax-id';
import {
  ConnectorDataError,
  type NormalizedCustomer,
} from '../../domain/connector';

/**
 * Small readers for the Kiwify webhook body. Root fields (order_id, order_status, webhook_event_type,
 * approved_date, Customer, Product, Commissions, Subscription) come from the Kiwify docs; the inner fields
 * of Customer, Product and Commissions are NOT documented for webhooks, so each reader accepts the
 * documented sales-API shape and the variants seen in real payloads. Confirm with a real "Testar Webhook".
 */
export type KiwifyBody = Record<string, unknown>;

const asObject = (value: unknown): KiwifyBody | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as KiwifyBody)
    : null;

export const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The first key of `source` that holds a non-empty text. */
function firstText(source: KiwifyBody | null, keys: string[]): string | null {
  for (const key of keys) {
    const found = text(source?.[key]);
    if (found) return found;
  }
  return null;
}

/** Amounts are integer cents: a number or a string of digits. Anything else is not an amount. */
export function cents(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim()))
    return Number(value.trim());
  return null;
}

function firstCents(source: KiwifyBody | null, keys: string[]): number | null {
  for (const key of keys) {
    const found = cents(source?.[key]);
    if (found !== null) return found;
  }
  return null;
}

/** Kiwify sends Brasilia time as "YYYY-MM-DD HH:mm"; ISO strings with an offset are accepted too. */
export function brasiliaDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(raw);
  const parsed = new Date(
    local ? `${local[1]}T${local[2]}${local[3] ?? ':00'}-03:00` : raw,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const BRAZIL = /^(br|bra|brasil|brazil)$/i;

export function readCustomer(body: KiwifyBody): NormalizedCustomer | null {
  const customer = asObject(body.Customer) ?? asObject(body.customer);
  if (!customer) return null;
  const name =
    firstText(customer, ['full_name', 'name']) ??
    ([text(customer.first_name), text(customer.last_name)]
      .filter(Boolean)
      .join(' ') ||
      null);
  const email = firstText(customer, ['email']);
  const country = text(customer.country);
  const rawDocument = firstText(customer, [
    'CPF',
    'cpf',
    'CNPJ',
    'cnpj',
    'document',
    'cpf_cnpj',
  ]);
  const masked = Boolean(rawDocument?.includes('*'));
  const foreign = Boolean(country && !BRAZIL.test(country));
  const parsed =
    rawDocument && !masked && !foreign ? parseCustomerTaxId(rawDocument) : null;
  if (!name && !email && !rawDocument) return null;
  return { name, email, taxId: parsed?.value ?? null, taxIdMasked: masked };
}

export function readProduct(body: KiwifyBody): {
  id: string | null;
  name: string | null;
} {
  const product = asObject(body.Product) ?? asObject(body.product);
  return {
    id: firstText(product, ['product_id', 'id']),
    name: firstText(product, ['product_name', 'name']),
  };
}

/** The buyer paid this much (installment interest included); falls back to the product price. */
export function readTotalCents(body: KiwifyBody): number | null {
  const commissions = asObject(body.Commissions);
  const payment = asObject(body.payment);
  return (
    firstCents(commissions, ['charge_amount']) ??
    firstCents(payment, ['charge_amount']) ??
    firstCents(commissions, ['product_base_price']) ??
    firstCents(payment, ['product_base_price'])
  );
}

/** The producer's own share, when the payload says it. */
export function readMyShareCents(body: KiwifyBody): number | null {
  return firstCents(asObject(body.Commissions), ['my_commission']);
}

/** Currency of the amounts; Kiwify is Brazilian, so a payload that names none is taken as BRL. */
export function readCurrency(body: KiwifyBody): string {
  const commissions = asObject(body.Commissions);
  const payment = asObject(body.payment);
  return (
    firstText(commissions, ['currency', 'charge_currency']) ??
    firstText(payment, ['charge_currency']) ??
    'BRL'
  ).toUpperCase();
}

/** True when the sale is not the producer's own (affiliate or coproducer), when the payload says so. */
export function isOtherPartySale(body: KiwifyBody): boolean {
  const saleType = text(body.sale_type);
  return Boolean(saleType && saleType.toLowerCase() !== 'producer');
}

export function readBody(rawBody: Buffer): KiwifyBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ConnectorDataError('Kiwify webhook body is not JSON');
  }
  const body = asObject(parsed);
  if (!body)
    throw new ConnectorDataError('Kiwify webhook body is not an object');
  return body;
}
