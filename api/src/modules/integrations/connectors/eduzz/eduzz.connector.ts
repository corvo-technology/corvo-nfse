import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeTaxID } from '@/shared/tax-id';
import {
  ConnectorDataError,
  type CommercialState,
  type Connector,
  type ConnectionView,
  type CustomerAddress,
  type DeliveryAuth,
  type InboundRequest,
  type IntegrationEnvironment,
  type NormalizedCustomer,
  type NormalizedOperation,
  type OperationDelivery,
  type ParsedDelivery,
} from '../../domain/connector';

/**
 * Fonte: https://developers.eduzz.com/docs/webhook e as páginas de referência
 * https://developers.eduzz.com/reference/webhook/myeduzz-invoice-paid (e -refunded, -chargeback, -canceled).
 * Cancelada, reembolsada e chargeback derrubam a venda; o que não houve pagamento é descartado pelo
 * pipeline (reembolso de venda desconhecida).
 */
const EVENT_STATE: Record<string, CommercialState> = {
  'myeduzz.invoice_paid': 'paid',
  'myeduzz.invoice_refunded': 'refunded',
  'myeduzz.invoice_chargeback': 'refunded',
  'myeduzz.invoice_canceled': 'refunded',
};
const SHARE_OPTION = 'mine';

interface Money {
  value?: unknown;
  currency?: unknown;
}
interface Person {
  name?: unknown;
  email?: unknown;
  document?: unknown;
  address?: {
    street?: unknown;
    number?: unknown;
    city?: unknown;
    state?: unknown;
    country?: unknown;
    zipCode?: unknown;
  } | null;
}
interface Envelope {
  id?: unknown;
  event?: unknown;
  sentDate?: unknown;
  data?: {
    id?: unknown;
    createdAt?: unknown;
    paidAt?: unknown;
    refundedAt?: unknown;
    price?: Money | null;
    paid?: Money | null;
    gains?: { producer?: Money | null } | null;
    refund?: { type?: unknown; refundedAt?: unknown } | null;
    transaction?: { id?: unknown } | null;
    buyer?: Person | null;
    items?: Array<{ productId?: unknown; name?: unknown }> | null;
  } | null;
}

function readBody(rawBody: Buffer): Envelope {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Eduzz webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** An id may come as a number or a string. */
const idOf = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : text(value);

const date = (value: unknown): Date | null => {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Eduzz sends reais as a JSON number. */
const cents = (money: Money | null | undefined): number | null =>
  typeof money?.value === 'number' && Number.isFinite(money.value)
    ? Math.round(money.value * 100)
    : null;

const isBrazil = (country: string | null): boolean =>
  !country || ['BRASIL', 'BRAZIL', 'BR'].includes(country.toUpperCase());

/**
 * Sales on an Eduzz producer account (MyEduzz "Fatura" webhooks). Eduzz signs the raw body with
 * HMAC-SHA256 in the `x-signature` header, using a secret key the producer creates in the Eduzz console;
 * the URL secret of the connection is checked together. Read-only: everything comes in the webhook body.
 *
 * Assumptions the docs leave open (to confirm with a real sale): the signature is the HMAC digest in hex
 * (base64 is accepted too); `data.gains.producer` also exists in the paid event (documented only on the
 * refunded one); the producer issues the invoice; order bumps arrive as items of the same invoice.
 */
@Injectable()
export class EduzzConnector implements Connector {
  readonly manifest = {
    id: 'eduzz',
    name: 'Eduzz',
    version: '1',
    credentialFields: [
      {
        key: 'secretKey',
        label:
          'Chave secreta da Eduzz (criada na tela de segurança do webhook)',
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
        optional: true,
        options: ['total', SHARE_OPTION],
      },
    ],
    webhookInstructions: {
      pt: 'Passo 1: no Console da Eduzz (console.eduzz.com), abra Webhooks > Segurança e crie uma chave secreta; copie e cole no campo "Chave secreta" aqui. Passo 2: crie o webhook com o endereço acima e marque os eventos de Fatura: Paga, Reembolsada, Chargeback e Cancelada. Passo 3: ative a URL e envie um teste. Atenção: o CPF/CNPJ do comprador só chega se o checkout pedir esse dado; sem ele a venda vai para "completar dados".',
      en: 'Step 1: in the Eduzz Console (console.eduzz.com), open Webhooks > Security and create a secret key; copy it and paste it in the "Secret key" field here. Step 2: create the webhook with the address above and select the Invoice events: Paid, Refunded, Chargeback and Canceled. Step 3: activate the URL and send a test. Note: the buyer tax ID only arrives if the checkout asks for it; without it the sale goes to "complete data".',
    },
    webhookEvents: [
      'myeduzz.invoice_paid',
      'myeduzz.invoice_refunded',
      'myeduzz.invoice_chargeback',
      'myeduzz.invoice_canceled',
    ],
    supportedFlows: ['invoice'],
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
    const signature = req.headers['x-signature'];
    if (!signature) return { ok: false, reason: 'missing_signature' };
    const key = connection.credentials.secretKey;
    // Without a key the signature proves nothing.
    if (!key) return { ok: false, reason: 'bad_signature' };
    const got = signature.trim();
    const hex = createHmac('sha256', key).update(req.rawBody).digest('hex');
    const b64 = createHmac('sha256', key).update(req.rawBody).digest('base64');
    return sameText(got.toLowerCase(), hex) || sameText(got, b64)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.event !== 'string') return { kind: 'test' };
    const event = body.event;
    if (!EVENT_STATE[event]) return { kind: 'ignored', externalType: event };
    if (
      event === 'myeduzz.invoice_refunded' &&
      body.data?.refund?.type === 'partial'
    )
      return { kind: 'ignored', externalType: event };
    const invoice = idOf(body.data?.id);
    if (!invoice) throw new ConnectorDataError('Eduzz webhook has no data.id');
    return {
      kind: 'operation',
      deliveryId: `${invoice}:${event}`,
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
    if (!state) throw new ConnectorDataError('Not an Eduzz invoice event');
    const data = body.data;
    const invoice = idOf(data?.id);
    if (!data || !invoice)
      throw new ConnectorDataError('Eduzz event has no data.id');

    const sent = date(body.sentDate);
    const paidAt = date(data.paidAt);
    const created = date(data.createdAt);
    const currency = (
      text(data.paid?.currency) ??
      text(data.price?.currency) ??
      'BRL'
    ).toUpperCase();
    const total = cents(data.paid) ?? cents(data.price);
    const paid = state === 'paid';
    if (paid && (total === null || total <= 0))
      throw new ConnectorDataError('Eduzz paid amount is not positive');
    const amountCents = paid
      ? this.invoiceAmount(total!, currency, data.gains, connection)
      : (total ?? 0);

    const items = (data.items ?? []).map((item) => ({
      externalProductId: idOf(item.productId),
      description: text(item.name),
      quantity: 1,
    }));
    const description =
      items
        .map((i) => i.description)
        .filter(Boolean)
        .join(', ') || null;
    const transaction = idOf(data.transaction?.id);
    return {
      operationKey: `eduzz:${invoice}`,
      commercialState: state,
      externalRefs: { invoice, ...(transaction ? { transaction } : {}) },
      ...(paid ? {} : { refersTo: { ref: 'invoice', value: invoice } }),
      occurredAt: paid
        ? (paidAt ?? created ?? sent ?? new Date())
        : (date(data.refundedAt) ??
          date(data.refund?.refundedAt) ??
          sent ??
          new Date()),
      paidAt: paid ? (paidAt ?? created ?? new Date()) : null,
      currency,
      amountCents,
      discountCents: 0,
      customer: paid ? this.customerOf(data.buyer) : null,
      items: paid ? items : [],
      description: paid ? description : null,
      // Assumption: the producer issues the invoice (Eduzz documents no field saying otherwise).
      sellerIssuesInvoice: true,
    };
  }

  /** The total paid, or (option "minha parte") what the producer earns: `data.gains.producer`. */
  private invoiceAmount(
    total: number,
    currency: string,
    gains: NonNullable<Envelope['data']>['gains'],
    connection: ConnectionView,
  ): number {
    if (connection.credentials.invoiceValue !== SHARE_OPTION) return total;
    const mine = cents(gains?.producer);
    const mineCurrency = text(gains?.producer?.currency)?.toUpperCase();
    if (
      mine === null ||
      mine <= 0 ||
      (mineCurrency && mineCurrency !== currency)
    )
      throw new ConnectorDataError(
        'Eduzz did not send a usable data.gains.producer to compute "minha parte"',
      );
    return mine;
  }

  /** A document counts only for a Brazilian buyer; anything else is completed by hand. */
  private customerOf(
    buyer: Person | null | undefined,
  ): NormalizedCustomer | null {
    if (!buyer) return null;
    const brazilian = isBrazil(text(buyer.address?.country));
    const address = brazilian ? this.addressOf(buyer.address) : undefined;
    return {
      name: text(buyer.name),
      email: text(buyer.email),
      taxId: brazilian ? (normalizeTaxID(text(buyer.document)) ?? null) : null,
      taxIdMasked: false,
      ...(address ? { address } : {}),
    };
  }

  private addressOf(
    raw: NonNullable<Person['address']> | null | undefined,
  ): CustomerAddress | undefined {
    if (!raw) return undefined;
    const street = [text(raw.street), idOf(raw.number)]
      .filter(Boolean)
      .join(', ');
    const city = text(raw.city);
    const state = text(raw.state)?.toUpperCase();
    const zip = text(raw.zipCode)?.replaceAll(/\D/g, '');
    return {
      ...(street ? { street } : {}),
      ...(city ? { city } : {}),
      // Free text in the docs example ("Estado"): keep only a real UF.
      ...(state && state.length === 2 ? { state } : {}),
      ...(zip && zip.length === 8 ? { zip } : {}),
      country: 'BR',
    };
  }

  validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string }> {
    // Eduzz names nothing about the account in the credentials: the id comes from the connection's own
    // URL secret, so rotating the secret key does not change the idempotency keys.
    const digest = createHash('sha256')
      .update(credentials.webhookSecret ?? '')
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `eduzz:${digest.slice(0, 24)}`,
    });
  }
}
