import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { MercadoPagoClient } from './mercadopago.client';

const MAX_ITEMS = 5;
/** The id the "simulate notification" button of the Mercado Pago panel sends. */
const SIMULATION_ID = '123456';
/** What the payment status means for the sale. Anything else is a payment that is not money yet. */
const STATUS_STATE: Record<string, CommercialState> = {
  approved: 'paid',
  refunded: 'refunded',
  charged_back: 'disputed',
  cancelled: 'canceled',
  rejected: 'canceled',
};

interface Notification {
  id?: unknown;
  type?: unknown;
  action?: unknown;
  live_mode?: unknown;
  user_id?: unknown;
  date_created?: unknown;
  data?: { id?: unknown } | null;
}

function readNotification(rawBody: Buffer): Notification {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Mercado Pago webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Ids come as strings or numbers. */
function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function amountCents(value: unknown): number {
  const reais = typeof value === 'string' ? Number(value) : value;
  if (typeof reais !== 'number' || !Number.isFinite(reais) || reais <= 0)
    throw new ConnectorDataError(
      'Mercado Pago transaction_amount is not a positive number',
    );
  return Math.round(reais * 100);
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value && typeof value === 'object' ? (value as Obj) : {};

function customerOf(payment: Obj): NormalizedCustomer | null {
  const payer = obj(payment.payer);
  const name =
    [text(payer.first_name), text(payer.last_name)]
      .filter(Boolean)
      .join(' ') || null;
  const email = text(payer.email);
  const identification = obj(payer.identification);
  const type = text(identification.type)?.toUpperCase();
  const number = text(identification.number);
  const taxId =
    (type === 'CPF' || type === 'CNPJ') && number
      ? (normalizeTaxID(number) ?? null)
      : null;
  const address = addressOf(obj(obj(payment.additional_info).payer).address);
  if (!name && !email && !taxId) return null;
  return {
    name,
    email,
    taxId,
    taxIdMasked: false,
    ...(address ? { address } : {}),
  };
}

function addressOf(value: unknown): CustomerAddress | null {
  const raw = obj(value);
  const street = [text(raw.street_name), idText(raw.street_number)]
    .filter(Boolean)
    .join(', ');
  const zip = text(raw.zip_code);
  if (!street && !zip) return null;
  return { ...(street ? { street } : {}), ...(zip ? { zip } : {}) };
}

function itemsOf(payment: Obj): NormalizedOperation['items'] {
  const list = obj(payment.additional_info).items;
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_ITEMS).map((entry: unknown) => {
    const item = obj(entry);
    const quantity = Number(item.quantity);
    return {
      externalProductId: idText(item.id),
      description: text(item.title),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    };
  });
}

/**
 * Payments received on a Mercado Pago account (Checkout Pro, Checkout API, links, Pix, boleto). The webhook only
 * names the payment, so the payment is read back with the client's Access Token (read-only: the connector never
 * charges, refunds or changes anything).
 */
@Injectable()
export class MercadoPagoConnector implements Connector {
  readonly manifest = {
    id: 'mercadopago',
    name: 'Mercado Pago',
    version: '1',
    credentialFields: [
      {
        key: 'accessToken',
        label: 'Access Token de produção do Mercado Pago',
        secret: true,
      },
      {
        key: 'webhookSigningSecret',
        label: 'Assinatura secreta do webhook',
        secret: true,
        afterUrl: true,
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      },
    ],
    webhookInstructions: {
      pt: 'Passo 1: no Mercado Pago, em "Suas integrações", abra (ou crie) sua aplicação, vá em Credenciais de produção e copie o Access Token. Cole aqui em "Access Token". A Corvo só consulta o pagamento recebido (CPF/CNPJ, e-mail e itens); não consegue cobrar, estornar nem alterar nada. Passo 2: copie o endereço do webhook mostrado aqui. Passo 3: na sua aplicação, em Webhooks > Configurar notificações, cole o endereço em "URL de produção", marque o evento "Pagamentos" (payment) e salve. Passo 4: o Mercado Pago mostra a "Assinatura secreta"; copie e cole aqui para ativar. Para a nota sair completa, peça o CPF/CNPJ do comprador no checkout; sem ele a venda vai para "Vendas pendentes".',
      en: 'Step 1: in Mercado Pago, under "Suas integrações" (Your integrations), open or create your application, go to Production credentials and copy the Access Token. Paste it here as "Access Token". Corvo only reads the payment it received (tax ID, e-mail and items); it cannot charge, refund or change anything. Step 2: copy the webhook address shown here. Step 3: in your application, under Webhooks > Configure notifications, paste the address as the production URL, tick the "Payments" (payment) event and save. Step 4: Mercado Pago shows the "Secret signature"; copy it and paste it here to activate. For a complete invoice, ask for the buyer tax ID (CPF/CNPJ) at checkout; without it the sale goes to "Pending sales".',
    },
    webhookEvents: ['payment'],
    supportedFlows: ['payment'],
  };

  constructor(
    private readonly client: MercadoPagoClient = new MercadoPagoClient(),
  ) {}

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  /** Signature over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, each part left out when absent. */
  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const urlSecret = req.query.webhookSecret;
    if (
      !urlSecret ||
      !sameText(urlSecret, connection.credentials.webhookSecret ?? '')
    )
      return { ok: false, reason: 'bad_secret' };
    const header = req.headers['x-signature'];
    if (!header) return { ok: false, reason: 'missing_signature' };
    const signingSecret = connection.credentials.webhookSigningSecret;
    if (!signingSecret) return { ok: false, reason: 'bad_signature' };

    let ts: string | undefined;
    let v1: string | undefined;
    for (const part of header.split(',')) {
      const [key, ...rest] = part.trim().split('=');
      const value = rest.join('=');
      if (key === 'ts') ts = value;
      else if (key === 'v1') v1 = value;
    }
    if (!ts || !v1) return { ok: false, reason: 'bad_signature' };

    let dataId = req.query['data.id'];
    if (!dataId) {
      try {
        dataId = idText(readNotification(req.rawBody).data?.id) ?? undefined;
      } catch {
        return { ok: false, reason: 'bad_signature' };
      }
    }
    const requestId = req.headers['x-request-id'];
    const manifest =
      (dataId ? `id:${dataId.toLowerCase()};` : '') +
      (requestId ? `request-id:${requestId};` : '') +
      `ts:${ts};`;
    const expected = createHmac('sha256', signingSecret)
      .update(manifest)
      .digest('hex');
    return sameText(v1, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readNotification(req.rawBody);
    if (typeof body.type !== 'string') return { kind: 'test' };
    if (body.type !== 'payment')
      return { kind: 'ignored', externalType: body.type };
    const paymentId = idText(body.data?.id);
    if (!paymentId)
      throw new ConnectorDataError('Mercado Pago webhook has no payment id');
    // The panel's "simulate" button sends a made-up payment that does not exist.
    if (paymentId === SIMULATION_ID && body.live_mode === false)
      return { kind: 'test' };
    const action = text(body.action) ?? 'payment';
    const userId = idText(body.user_id);
    return {
      kind: 'operation',
      // One payment sends several notices (created, updated...): the action and date tell them apart.
      deliveryId: `${paymentId}:${action}:${text(body.date_created) ?? idText(body.id) ?? ''}`,
      externalType: action,
      ...(typeof body.live_mode === 'boolean'
        ? { environment: body.live_mode ? 'live' : 'test' }
        : {}),
      ...(userId ? { externalAccountId: userId } : {}),
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    // Errors must surface as rejections, like any other async connector call.
    return this.toOperation(
      input.payload,
      input.connection.credentials.accessToken,
    );
  }

  private async toOperation(
    payload: unknown,
    accessToken: string | undefined,
  ): Promise<NormalizedOperation> {
    const notification = readNotification(
      Buffer.from(String(payload), 'utf8'),
    );
    const paymentId = idText(notification.data?.id);
    if (!paymentId)
      throw new ConnectorDataError('Mercado Pago webhook has no payment id');
    if (!accessToken)
      throw new ConnectorDataError('Mercado Pago connection has no token');
    const payment = await this.client.getPayment(accessToken, paymentId);
    const status = text(payment.status) ?? '';
    const state = STATUS_STATE[status] ?? 'pending';
    const approvedAt = dateOf(payment.date_approved);
    const created = dateOf(payment.date_created) ?? new Date();
    const updated = dateOf(payment.date_last_updated) ?? created;
    const items = itemsOf(payment);
    const titles = [
      ...new Set(items.map((item) => item.description).filter(Boolean)),
    ] as string[];
    const reference = text(payment.external_reference);
    return {
      operationKey: `mercadopago:${paymentId}`,
      commercialState: state,
      externalRefs: {
        paymentId,
        ...(reference ? { externalReference: reference } : {}),
      },
      occurredAt: state === 'paid' ? (approvedAt ?? created) : updated,
      paidAt: approvedAt,
      currency: (text(payment.currency_id) ?? 'BRL').toUpperCase(),
      amountCents: amountCents(payment.transaction_amount),
      discountCents: 0,
      customer: customerOf(payment),
      items,
      description: titles.length ? titles.join(', ') : text(payment.description),
      sellerIssuesInvoice: true,
    };
  }

  async validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string | null }> {
    const token = credentials.accessToken;
    if (!token) throw new ConnectorDataError('Missing Access Token');
    return { externalAccountId: await this.client.getUserId(token) };
  }
}
