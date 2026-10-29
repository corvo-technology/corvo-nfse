import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
import { AbacatePayClient } from './abacatepay.client';

const STATE_BY_SUFFIX: Record<string, CommercialState> = {
  completed: 'paid',
  refunded: 'refunded',
  disputed: 'disputed',
};
const PAYMENT_EVENT = /^(checkout|transparent)\.(completed|refunded|disputed)$/;

interface Payment {
  id?: string;
  externalId?: string | null;
  amount?: unknown;
  updatedAt?: string;
  createdAt?: string;
  items?: Array<{ id?: string; quantity?: number }>;
}
interface Envelope {
  id?: unknown;
  event?: unknown;
  devMode?: unknown;
  data?: {
    checkout?: Payment;
    transparent?: Payment;
    customer?: {
      id?: string;
      name?: string;
      email?: string;
      taxId?: string;
    } | null;
  };
}

function readBody(rawBody: Buffer): Envelope {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('AbacatePay webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Checkout and transparent (Pix/card/boleto) payments on an AbacatePay account (API v2).
 * `hmacPublicKey` is the key behind `X-Webhook-Signature`; while it is unknown the URL secret authenticates alone.
 */
@Injectable()
export class AbacatePayConnector implements Connector {
  readonly manifest = {
    id: 'abacatepay',
    name: 'AbacatePay',
    version: '1',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Chave de API da AbacatePay',
        secret: true,
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
      pt: 'No painel da AbacatePay, cadastre um webhook com a URL desta conexão (já com ?webhookSecret=) e marque checkout.completed, checkout.refunded, checkout.disputed e os eventos transparent.* equivalentes.',
      en: 'In the AbacatePay dashboard, register a webhook with this connection URL (already containing ?webhookSecret=) and select checkout.completed, checkout.refunded, checkout.disputed and the equivalent transparent.* events.',
    },
    supportedFlows: ['checkout', 'transparent'],
  };

  constructor(
    private readonly hmacPublicKey?: string,
    private readonly client: AbacatePayClient = new AbacatePayClient(),
  ) {}

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const secret = req.query.webhookSecret;
    if (!secret || !sameText(secret, connection.credentials.webhookSecret))
      return { ok: false, reason: 'bad_secret' };
    if (!this.hmacPublicKey) return { ok: true };
    const signature = req.headers['x-webhook-signature'];
    if (!signature) return { ok: false, reason: 'missing_signature' };
    const expected = createHmac('sha256', this.hmacPublicKey)
      .update(req.rawBody)
      .digest('base64');
    return sameText(signature, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.event !== 'string') return { kind: 'test' };
    if (!PAYMENT_EVENT.test(body.event))
      return { kind: 'ignored', externalType: body.event };
    if (typeof body.id !== 'string' || !body.id)
      throw new ConnectorDataError('AbacatePay webhook has no id');
    return {
      kind: 'operation',
      deliveryId: body.id,
      externalType: body.event,
      ...(typeof body.devMode === 'boolean'
        ? { environment: body.devMode ? 'test' : 'live' }
        : {}),
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    // Errors must surface as rejections, like any other async connector call.
    return this.toOperation(input.payload, input.connection.credentials.apiKey);
  }

  private async toOperation(
    payload: unknown,
    apiKey: string | undefined,
  ): Promise<NormalizedOperation> {
    const body = readBody(Buffer.from(String(payload), 'utf8'));
    const match =
      typeof body.event === 'string' ? PAYMENT_EVENT.exec(body.event) : null;
    if (!match) throw new ConnectorDataError('Not an AbacatePay payment event');
    const [, kind, suffix] = match as unknown as [
      string,
      'checkout' | 'transparent',
      string,
    ];
    const payment = body.data?.[kind];
    if (!payment?.id)
      throw new ConnectorDataError(`AbacatePay event has no data.${kind}.id`);
    if (!Number.isInteger(payment.amount) || (payment.amount as number) <= 0)
      throw new ConnectorDataError(
        'AbacatePay amount is not a positive integer number of cents',
      );
    let customer = toCustomer(body.data?.customer);
    // The webhook masks the document; with the client's key the full one is one call away.
    if (customer?.taxIdMasked && apiKey && body.data?.customer?.id) {
      const full = await this.client.getCustomer(apiKey, body.data.customer.id);
      const taxId = normalizeTaxID(full.taxId ?? undefined);
      if (taxId) customer = { ...customer, taxId, taxIdMasked: false };
    }
    const at = new Date(payment.updatedAt ?? payment.createdAt ?? Date.now());
    return {
      operationKey: `${kind}:${payment.id}`,
      commercialState: STATE_BY_SUFFIX[suffix],
      externalRefs: {
        [`${kind}Id`]: payment.id,
        ...(payment.externalId ? { externalId: payment.externalId } : {}),
      },
      occurredAt: at,
      paidAt: at,
      currency: 'BRL',
      amountCents: payment.amount as number,
      discountCents: 0,
      customer,
      items: (payment.items ?? []).map((item) => ({
        externalProductId: item.id ?? null,
        description: null,
        quantity: item.quantity ?? 1,
      })),
      sellerIssuesInvoice: true,
    };
  }

  async validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string }> {
    if (credentials.apiKey)
      await this.client.checkCredentials(credentials.apiKey);
    const digest = createHash('sha256')
      .update(credentials.webhookSecret)
      .digest('hex');
    return { externalAccountId: `abacatepay:${digest.slice(0, 24)}` };
  }
}

function toCustomer(
  customer:
    | { name?: string; email?: string; taxId?: string }
    | null
    | undefined,
): NormalizedCustomer | null {
  if (!customer) return null;
  const masked = customer.taxId?.includes('*') ?? false;
  return {
    name: customer.name ?? null,
    email: customer.email ?? null,
    taxId: masked ? null : (normalizeTaxID(customer.taxId) ?? null),
    taxIdMasked: masked,
  };
}
