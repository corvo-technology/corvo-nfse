import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeTaxID } from '@/shared/tax-id';
import {
  ConnectorDataError,
  type CommercialState,
  type Connector,
  type ConnectionView,
  type DeliveryAuth,
  type InboundRequest,
  type IntegrationEnvironment,
  type NormalizedCustomer,
  type NormalizedOperation,
  type OperationDelivery,
  type ParsedDelivery,
} from '../../domain/connector';

const PAID_EVENTS = new Set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']);
const EVENT_STATE: Record<string, CommercialState> = {
  PURCHASE_APPROVED: 'paid',
  PURCHASE_COMPLETE: 'paid',
  PURCHASE_REFUNDED: 'refunded',
  PURCHASE_CHARGEBACK: 'refunded',
  PURCHASE_PROTEST: 'disputed',
};
const BRAZILIAN_DOCUMENT_TYPES = new Set(['CPF', 'CNPJ']);
/** What the producer does not keep, for the "minha parte" option. */
const SHARED_SOURCES = new Set(['COPRODUCER', 'AFFILIATE']);
const SHARE_OPTION = 'share';

interface Money {
  value?: unknown;
  currency_value?: unknown;
}
interface Commission extends Money {
  source?: unknown;
}
interface Envelope {
  id?: unknown;
  creation_date?: unknown;
  event?: unknown;
  data?: {
    product?: { id?: unknown; name?: unknown } | null;
    buyer?: {
      name?: unknown;
      email?: unknown;
      document?: unknown;
      document_type?: unknown;
      address?: { country_iso?: unknown } | null;
    } | null;
    commissions?: unknown;
    purchase?: {
      transaction?: unknown;
      status?: unknown;
      approved_date?: unknown;
      full_price?: Money | null;
      business_model?: unknown;
      invoice_by?: unknown;
    } | null;
  } | null;
}

function readBody(rawBody: Buffer): Envelope {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Hotmart webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const millis = (value: unknown): Date | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value) : null;

/** Hotmart sends reais as a JSON number. */
const cents = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;

/** `commissions` is a list (documented examples); an object, or one entry, is accepted too. */
function commissionList(raw: unknown): Commission[] {
  if (Array.isArray(raw)) return raw as Commission[];
  if (!raw || typeof raw !== 'object') return [];
  const values = Object.values(raw as Record<string, unknown>);
  if (values.length > 0 && values.every((v) => v && typeof v === 'object'))
    return values.flatMap((v) =>
      Array.isArray(v) ? (v as Commission[]) : [v as Commission],
    );
  return [raw];
}

/**
 * Sales on a Hotmart producer account (webhook 2.0). Hotmart has no signature: the account token
 * (`hottok`, header `X-HOTMART-HOTTOK`) plus the URL secret of the connection authenticate together.
 * Read-only and without calls to Hotmart: everything comes in the webhook body.
 */
@Injectable()
export class HotmartConnector implements Connector {
  readonly manifest = {
    id: 'hotmart',
    name: 'Hotmart',
    version: '1',
    credentialFields: [
      {
        key: 'hottok',
        label: 'Hottok da Hotmart (token do webhook)',
        secret: true,
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      },
      {
        key: 'invoiceValue',
        label: 'Valor da nota',
        secret: false,
        choices: [
          { value: 'total', label: 'Total pago pelo comprador' },
          {
            value: SHARE_OPTION,
            label: 'Minha parte (total menos coprodutor e afiliado)',
          },
        ],
      },
    ],
    webhookInstructions: {
      pt: 'Passo 1: na Hotmart, vá em Ferramentas > Webhook (API e Notificações), cadastre o endereço do webhook para todos os produtos e marque os eventos: compra aprovada, compra completa, reembolso, chargeback e protesto. Passo 2: copie o seu hottok (na mesma tela) e cole no campo "Hottok". Passo 3: envie um teste pela Hotmart. Atenção: o CPF/CNPJ do comprador só chega se o checkout pedir esse dado; sem ele a venda vai para "completar dados".',
      en: 'Step 1: in Hotmart, go to Tools > Webhook (API and Notifications), add the webhook address for all products and select the events: purchase approved, purchase complete, refund, chargeback and protest. Step 2: copy your hottok (same screen) and paste it in the "Hottok" field. Step 3: send a test from Hotmart. Note: the buyer tax ID only arrives if the checkout asks for it; without it the sale goes to "complete data".',
    },
    supportedFlows: ['purchase'],
  };

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const urlSecret = req.query.webhookSecret;
    if (
      !urlSecret ||
      !sameText(urlSecret, connection.credentials.webhookSecret ?? '')
    )
      return { ok: false, reason: 'bad_secret' };
    const hottok = req.headers['x-hotmart-hottok'];
    if (!hottok) return { ok: false, reason: 'missing_hottok' };
    const expected = connection.credentials.hottok;
    return expected && sameText(hottok, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_hottok' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.event !== 'string') return { kind: 'test' };
    const event = body.event;
    if (!EVENT_STATE[event]) return { kind: 'ignored', externalType: event };
    const purchase = body.data?.purchase;
    const transaction = text(purchase?.transaction);
    // Affiliate notices carry no price: the sale is not ours to invoice.
    if (PAID_EVENTS.has(event) && !purchase?.full_price)
      return { kind: 'ignored', externalType: event };
    if (
      event === 'PURCHASE_REFUNDED' &&
      purchase?.status === 'PARTIALLY_REFUNDED'
    )
      return { kind: 'ignored', externalType: event };
    if (!transaction)
      throw new ConnectorDataError(
        'Hotmart webhook has no purchase.transaction',
      );
    return {
      kind: 'operation',
      deliveryId: `${transaction}:${event}`,
      externalType: event,
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    // Errors must surface as rejections, like any other async connector call.
    return new Promise((resolve) =>
      resolve(this.toOperation(input.payload, input.connection)),
    );
  }

  private toOperation(
    payload: unknown,
    connection: ConnectionView,
  ): NormalizedOperation {
    const body = readBody(Buffer.from(String(payload), 'utf8'));
    const event = typeof body.event === 'string' ? body.event : '';
    const state = EVENT_STATE[event];
    if (!state) throw new ConnectorDataError('Not a Hotmart purchase event');
    const purchase = body.data?.purchase;
    const transaction = text(purchase?.transaction);
    if (!purchase || !transaction)
      throw new ConnectorDataError('Hotmart event has no purchase.transaction');

    const created = millis(body.creation_date);
    const approved = millis(purchase.approved_date);
    const currency = (
      text(purchase.full_price?.currency_value) ?? 'BRL'
    ).toUpperCase();
    const total = cents(purchase.full_price?.value);
    const paid = state === 'paid';
    if (paid && (total === null || total <= 0))
      throw new ConnectorDataError(
        'Hotmart full_price is not a positive amount',
      );
    const amountCents = paid
      ? this.invoiceAmount(
          total!,
          currency,
          body.data?.commissions,
          connection.credentials.invoiceValue,
        )
      : (total ?? 0);

    const product = body.data?.product;
    const productId =
      typeof product?.id === 'number' || typeof product?.id === 'string'
        ? String(product.id)
        : null;
    const name = text(product?.name);
    return {
      operationKey: `hotmart:${transaction}`,
      commercialState: state,
      externalRefs: { transaction },
      ...(paid ? {} : { refersTo: { ref: 'transaction', value: transaction } }),
      occurredAt: paid
        ? (approved ?? created ?? new Date())
        : (created ?? approved ?? new Date()),
      paidAt: paid ? (approved ?? created ?? new Date()) : null,
      currency,
      amountCents,
      discountCents: 0,
      customer: paid ? this.customerOf(body.data?.buyer) : null,
      items: [{ externalProductId: productId, description: name, quantity: 1 }],
      description: name,
      sellerIssuesInvoice:
        purchase.invoice_by === 'SELLER' && purchase.business_model !== 'R',
    };
  }

  /** The total paid, or (option "minha parte") the total minus what coproducers and affiliates take. */
  private invoiceAmount(
    total: number,
    currency: string,
    commissions: unknown,
    option: string | undefined,
  ): number {
    if (option !== SHARE_OPTION) return total;
    const entries = commissionList(commissions);
    if (entries.length === 0)
      throw new ConnectorDataError(
        'Hotmart sent no commissions to compute "minha parte"',
      );
    let shared = 0;
    for (const entry of entries) {
      if (typeof entry.source !== 'string' || !SHARED_SOURCES.has(entry.source))
        continue;
      const value = cents(entry.value);
      const entryCurrency = text(entry.currency_value)?.toUpperCase();
      if (value === null || (entryCurrency && entryCurrency !== currency))
        throw new ConnectorDataError(
          'Hotmart commission is unreadable or in another currency',
        );
      shared += value;
    }
    if (total - shared <= 0)
      throw new ConnectorDataError(
        'Hotmart "minha parte" is not a positive amount',
      );
    return total - shared;
  }

  /** A document counts only for a Brazilian buyer with a CPF or CNPJ; anything else is completed by hand. */
  private customerOf(
    buyer: NonNullable<Envelope['data']>['buyer'],
  ): NormalizedCustomer | null {
    if (!buyer) return null;
    const country = text(buyer.address?.country_iso)?.toUpperCase();
    const documentType = text(buyer.document_type)?.toUpperCase();
    const brazilian =
      (!country || country === 'BR') &&
      (!documentType || BRAZILIAN_DOCUMENT_TYPES.has(documentType));
    return {
      name: text(buyer.name),
      email: text(buyer.email),
      taxId: brazilian ? (normalizeTaxID(text(buyer.document)) ?? null) : null,
      taxIdMasked: false,
    };
  }

  validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string }> {
    // Hotmart names nothing about the account: the id comes from the connection's own secret,
    // so rotating the hottok does not change the idempotency keys.
    const digest = createHash('sha256')
      .update(credentials.webhookSecret ?? '')
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `hotmart:${digest.slice(0, 24)}`,
    });
  }
}
