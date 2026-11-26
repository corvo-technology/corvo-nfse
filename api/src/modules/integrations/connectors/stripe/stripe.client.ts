import { Injectable } from '@nestjs/common';
import {
  ConnectorAuthError,
  ConnectorDataError,
  ConnectorTransientError,
} from '../../domain/connector';

const BASE_URL = 'https://api.stripe.com';

export interface StripeTaxId {
  type: string;
  value: string;
}

export interface StripeCustomer {
  name: string | null;
  email: string | null;
  taxIds: StripeTaxId[];
}

export interface StripeSaleLine {
  /** What was sold, as the line describes it (the product name). */
  description: string | null;
  quantity: number;
  productId: string | null;
}

export interface StripeCheckoutSession {
  taxIds: StripeTaxId[];
  lines: StripeSaleLine[];
}

interface RawTaxId {
  type?: unknown;
  value?: unknown;
}
interface RawLine {
  description?: unknown;
  quantity?: unknown;
  price?: { product?: unknown } | null;
}

function toTaxIds(list: unknown): StripeTaxId[] {
  if (!Array.isArray(list)) return [];
  return (list as RawTaxId[]).flatMap((entry) =>
    typeof entry?.type === 'string' && typeof entry.value === 'string'
      ? [{ type: entry.type, value: entry.value }]
      : [],
  );
}

function toLines(list: unknown, limit: number): StripeSaleLine[] {
  if (!Array.isArray(list)) return [];
  return (list as RawLine[]).slice(0, limit).map((line) => ({
    description:
      typeof line?.description === 'string' && line.description.trim()
        ? line.description.trim()
        : null,
    quantity:
      typeof line?.quantity === 'number' && line.quantity > 0
        ? line.quantity
        : 1,
    productId:
      typeof line?.price?.product === 'string' ? line.price.product : null,
  }));
}

/** Read-only calls to the Stripe API made with the client's own restricted key. Plain fetch, no SDK. */
@Injectable()
export class StripeClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** The account the key belongs to: proves the key works and names the account. */
  async getAccountId(apiKey: string): Promise<string> {
    const body = await this.getJson<{ id?: unknown }>(apiKey, '/v1/account');
    if (typeof body?.id !== 'string' || !body.id)
      throw new ConnectorDataError('Stripe did not return the account id');
    return body.id;
  }

  /** Name, e-mail and tax ids (CPF/CNPJ) of a customer. */
  async getCustomer(
    apiKey: string,
    customerId: string,
  ): Promise<StripeCustomer> {
    const body = await this.getJson<{
      name?: unknown;
      email?: unknown;
      tax_ids?: { data?: unknown } | null;
    }>(
      apiKey,
      `/v1/customers/${encodeURIComponent(customerId)}?expand[]=tax_ids`,
    );
    return {
      name: typeof body?.name === 'string' && body.name ? body.name : null,
      email: typeof body?.email === 'string' && body.email ? body.email : null,
      taxIds: toTaxIds(body?.tax_ids?.data),
    };
  }

  /** The Checkout Session that created a payment, with the document the buyer typed and the items bought. */
  async findCheckoutSession(
    apiKey: string,
    paymentIntentId: string,
    maxLines: number,
  ): Promise<StripeCheckoutSession | null> {
    const body = await this.getJson<{
      data?: Array<{
        customer_details?: { tax_ids?: unknown } | null;
        line_items?: { data?: unknown } | null;
      }>;
    }>(
      apiKey,
      `/v1/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=1&expand[]=data.line_items`,
    );
    const session = body?.data?.[0];
    if (!session) return null;
    return {
      taxIds: toTaxIds(session.customer_details?.tax_ids),
      lines: toLines(session.line_items?.data, maxLines),
    };
  }

  /** The lines of the invoice that a subscription payment settled. */
  async getInvoiceLines(
    apiKey: string,
    invoiceId: string,
    maxLines: number,
  ): Promise<StripeSaleLine[]> {
    const body = await this.getJson<{ lines?: { data?: unknown } | null }>(
      apiKey,
      `/v1/invoices/${encodeURIComponent(invoiceId)}`,
    );
    return toLines(body?.lines?.data, maxLines);
  }

  private async getJson<T>(apiKey: string, path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorTransientError('Could not reach Stripe');
    }
    if (response.ok)
      return (await response.json().catch(() => null)) as T | null;
    if (response.status === 401 || response.status === 403)
      throw new ConnectorAuthError('O Stripe recusou a chave restrita');
    if (response.status === 429 || response.status >= 500)
      throw new ConnectorTransientError(`Stripe answered ${response.status}`);
    throw new ConnectorDataError(`Stripe answered ${response.status}`);
  }
}
