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

/** Events we act on, and what the sale becomes (https://docs.pagar.me/reference/eventos-de-webhook-1). */
const EVENT_STATE: Record<string, CommercialState> = {
  'order.paid': 'paid',
  'charge.refunded': 'refunded',
  'order.canceled': 'refunded',
  'charge.chargedback': 'disputed',
  'chargeback.received': 'disputed',
};
const BRAZILIAN_DOCUMENT_TYPES = new Set(['CPF', 'CNPJ']);

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(rawBody: Buffer): Json {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  const body = asObject(parsed);
  if (!body) throw new ConnectorDataError('Pagar.me webhook is not an object');
  return body;
}

/** Pagar.me sends UTC times, sometimes without the "Z": no zone means UTC. */
function utcDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const hasZone = raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw);
  const parsed = new Date(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The id of the charge a refund or chargeback event talks about. */
function chargeIdOf(type: string, data: Json | null): string | null {
  if (!data) return null;
  if (type === 'chargeback.received') {
    // The chargeback notice has no documented sample: accept the charge as a child, a plain
    // reference, or the notice itself when its id is a charge id.
    const nested = text(asObject(data.charge)?.id) ?? text(data.charge_id);
    if (nested) return nested;
    const own = text(data.id);
    return own?.startsWith('ch_') ? own : null;
  }
  return text(data.id);
}

function addressOf(source: Json | null): CustomerAddress | undefined {
  const address = asObject(source?.address);
  if (!address) return undefined;
  const street =
    [text(address.line_1), text(address.line_2)].filter(Boolean).join(', ') ||
    undefined;
  const result: CustomerAddress = {
    street,
    city: text(address.city) ?? undefined,
    state: text(address.state) ?? undefined,
    zip: text(address.zip_code) ?? undefined,
    country: text(address.country) ?? undefined,
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function customerOf(data: Json): NormalizedCustomer | null {
  const customer = asObject(data.customer);
  if (!customer) return null;
  const documentType = text(customer.document_type)?.toUpperCase();
  const brazilian = !documentType || BRAZILIAN_DOCUMENT_TYPES.has(documentType);
  const address = addressOf(customer) ?? addressOf(asObject(data.shipping));
  return {
    name: text(customer.name),
    email: text(customer.email),
    taxId: brazilian ? (normalizeTaxID(text(customer.document)) ?? null) : null,
    taxIdMasked: false,
    ...(address ? { address } : {}),
  };
}

/**
 * Sales on a Pagar.me account (API v5), by webhook only: `order.paid` issues; a refund, a cancelled
 * order and a chargeback tie back to the sale by charge or order id. The v5 docs describe no webhook
 * signature, so the URL secret is the required proof. We also check HTTP Basic credentials when the call
 * carries them, and the X-Hub-Signature (HMAC-SHA1 of the raw body, key = secret key) when the merchant
 * gave us the secret key. Nothing is ever fetched from Pagar.me.
 */
@Injectable()
export class PagarmeConnector implements Connector {
  readonly manifest = {
    id: 'pagarme',
    name: 'Pagar.me',
    version: '1',
    credentialFields: [
      {
        key: 'webhookSecret',
        label: 'Segredo do webhook',
        secret: true,
        generate: true,
        inWebhookUrl: true,
      },
      {
        key: 'webhookUser',
        label: 'Usuário do webhook (autenticação básica)',
        secret: true,
        generate: true,
        revealOnce: true,
      },
      {
        key: 'webhookPassword',
        label: 'Senha do webhook (autenticação básica)',
        secret: true,
        generate: true,
        revealOnce: true,
      },
      {
        key: 'secretKey',
        label: 'Chave secreta da Pagar.me (opcional, confere a assinatura)',
        secret: true,
        optional: true,
      },
    ],
    webhookInstructions: {
      pt: 'Passo 1: copie o endereço do webhook da Corvo (e o usuário e a senha mostrados uma única vez). Passo 2: no Dashboard da Pagar.me, em Configurações > Webhooks, crie um webhook com esse endereço e marque os eventos: order.paid, charge.refunded, order.canceled, charge.chargedback e chargeback.received. Se houver campos de usuário e senha, preencha com os valores mostrados aqui. Passo 3 (opcional): cole a chave secreta (sk_...) da conta para a Corvo conferir a assinatura X-Hub-Signature. Passo 4: faça uma venda de teste. Atenção: o CPF/CNPJ do comprador só chega se o checkout pedir esse dado; sem ele a venda vai para "Vendas pendentes". Reembolso parcial é ignorado.',
      en: 'Step 1: copy the Corvo webhook address (and the user and password shown only once). Step 2: in the Pagar.me Dashboard, under Settings > Webhooks, create a webhook with that address and tick the events: order.paid, charge.refunded, order.canceled, charge.chargedback and chargeback.received. If there are user and password fields, fill them with the values shown here. Step 3 (optional): paste the account secret key (sk_...) so Corvo checks the X-Hub-Signature. Step 4: make a test sale. Note: the buyer tax ID only arrives if the checkout asks for it; without it the sale goes to "Pending sales". Partial refunds are ignored.',
    },
    webhookEvents: Object.keys(EVENT_STATE),
    supportedFlows: ['order'],
  };

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const { credentials } = connection;
    const secret = req.query.webhookSecret;
    if (
      !secret ||
      !credentials.webhookSecret ||
      !sameText(secret, credentials.webhookSecret)
    )
      return { ok: false, reason: 'bad_secret' };

    // HTTP Basic: when the call carries credentials they must be ours.
    const authorization = req.headers.authorization;
    if (
      authorization &&
      credentials.webhookUser &&
      credentials.webhookPassword
    ) {
      const expected = `Basic ${Buffer.from(
        `${credentials.webhookUser}:${credentials.webhookPassword}`,
      ).toString('base64')}`;
      if (!sameText(authorization, expected))
        return { ok: false, reason: 'bad_basic_auth' };
    }

    // Signature: the merchant opted in by giving us the secret key, so it must be there and right.
    if (credentials.secretKey) {
      const header = req.headers['x-hub-signature'];
      if (!header) return { ok: false, reason: 'missing_signature' };
      const expected = `sha1=${createHmac('sha1', credentials.secretKey)
        .update(req.rawBody)
        .digest('hex')}`;
      if (!sameText(header.trim().toLowerCase(), expected))
        return { ok: false, reason: 'bad_signature' };
    }
    return { ok: true };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    const type = text(body.type);
    if (!type) return { kind: 'test' };
    if (!EVENT_STATE[type]) return { kind: 'ignored', externalType: type };
    const data = asObject(body.data);
    if (type === 'order.paid' && text(data?.status) !== 'paid')
      return { kind: 'ignored', externalType: type };
    const id =
      type === 'order.paid' || type === 'order.canceled'
        ? text(data?.id)
        : chargeIdOf(type, data);
    if (!id) throw new ConnectorDataError(`Pagar.me ${type} has no data.id`);
    return {
      kind: 'operation',
      deliveryId: `${id}:${type}`,
      externalType: type,
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    // Errors must surface as rejections, like any other async connector call.
    return Promise.resolve().then(() => this.toOperation(input.payload));
  }

  private toOperation(payload: unknown): NormalizedOperation {
    const body = readBody(Buffer.from(String(payload), 'utf8'));
    const type = text(body.type) ?? '';
    const state = EVENT_STATE[type];
    if (!state) throw new ConnectorDataError('Not a Pagar.me sale event');
    const data = asObject(body.data);
    if (!data) throw new ConnectorDataError('Pagar.me event has no data');
    const eventAt = utcDate(body.created_at);

    if (type !== 'order.paid') {
      // A refund, cancellation or chargeback only names the sale: the handler swaps in that sale's data.
      const ref = type === 'order.canceled' ? 'orderId' : 'chargeId';
      const value =
        type === 'order.canceled' ? text(data.id) : chargeIdOf(type, data);
      if (!value) throw new ConnectorDataError(`Pagar.me ${type} has no id`);
      return {
        operationKey: `pagarme:${value}`,
        commercialState: state,
        externalRefs: {},
        refersTo: { ref, value },
        occurredAt: eventAt ?? new Date(),
        paidAt: null,
        currency: (text(data.currency) ?? 'BRL').toUpperCase(),
        amountCents: 0,
        discountCents: 0,
        customer: null,
        items: [],
        description: null,
        sellerIssuesInvoice: true,
      };
    }

    const orderId = text(data.id);
    if (!orderId) throw new ConnectorDataError('Pagar.me order has no id');
    const amount = data.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)
      throw new ConnectorDataError(
        'Pagar.me amount is not a positive integer number of cents',
      );
    const charges = (Array.isArray(data.charges) ? data.charges : [])
      .map(asObject)
      .filter((c): c is Json => c !== null);
    const charge = charges.find((c) => text(c.status) === 'paid') ?? charges[0];
    const chargeId = text(charge?.id);
    const code = text(data.code);
    const paidAt =
      utcDate(charge?.paid_at) ??
      utcDate(data.closed_at) ??
      eventAt ??
      new Date();

    const items = (Array.isArray(data.items) ? data.items : [])
      .map(asObject)
      .filter((i): i is Json => i !== null)
      .map((item) => {
        const quantity = item.quantity;
        return {
          externalProductId: text(item.code),
          description: text(item.description),
          quantity:
            typeof quantity === 'number' &&
            Number.isInteger(quantity) &&
            quantity > 0
              ? quantity
              : 1,
        };
      });
    return {
      operationKey: `pagarme:${orderId}`,
      commercialState: 'paid',
      externalRefs: {
        orderId,
        ...(chargeId ? { chargeId } : {}),
        ...(code ? { orderCode: code } : {}),
      },
      occurredAt: paidAt,
      paidAt,
      currency: (text(data.currency) ?? 'BRL').toUpperCase(),
      amountCents: amount,
      discountCents: 0,
      customer: customerOf(data),
      items,
      description: items[0]?.description ?? null,
      sellerIssuesInvoice: true,
    };
  }

  validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
    connection: { publicId: string },
  ): Promise<{ externalAccountId: string }> {
    // Nothing to ask Pagar.me: the account id comes from the connection's own secret.
    const digest = createHash('sha256')
      .update(credentials.webhookSecret || connection.publicId)
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `pagarme:${digest.slice(0, 24)}`,
    });
  }
}
