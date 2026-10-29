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
const TIMESTAMP_TOLERANCE_SECONDS = 300;
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
      pt: 'Na AbacatePay, abra Integração e crie um webhook. No campo da URL, cole o endereço completo mostrado aqui, inclusive a parte ?webhookSecret=.... No campo Secret, cole o Secret mostrado aqui (a AbacatePay assina os avisos com ele). Nos eventos, marque checkout.completed, checkout.refunded, checkout.disputed e os equivalentes transparent.*. Salve.',
      en: 'In AbacatePay, open Integration and create a webhook. In the URL field, paste the full address shown here, including the ?webhookSecret=... part. In the Secret field, paste the Secret shown here (AbacatePay signs the notifications with it). For events, select checkout.completed, checkout.refunded, checkout.disputed and the equivalent transparent.* events. Save.',
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
    const id = req.headers['webhook-id'];
    const timestamp = req.headers['webhook-timestamp'];
    const signatures = req.headers['webhook-signature'];
    if (id && timestamp && signatures)
      return this.checkStandard(
        req.rawBody,
        id,
        timestamp,
        signatures,
        connection,
      );
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

  /**
   * Standard Webhooks: HMAC-SHA256 of `id.timestamp.body` with the webhook secret.
   * A `whsec_` secret is base64 (the key is the decoded part); any other secret is used as written.
   */
  private checkStandard(
    rawBody: Buffer,
    id: string,
    timestamp: string,
    signatures: string,
    connection: ConnectionView,
  ): DeliveryAuth {
    const seconds = Number(timestamp);
    if (
      !Number.isInteger(seconds) ||
      Math.abs(Date.now() / 1000 - seconds) > TIMESTAMP_TOLERANCE_SECONDS
    )
      return { ok: false, reason: 'stale_timestamp' };
    const secret = connection.credentials.webhookSecret;
    const keys = secret.startsWith('whsec_')
      ? [Buffer.from(secret.slice(6), 'base64')]
      : [Buffer.from(secret, 'utf8')];
    const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody]);
    const candidates = signatures
      .split(' ')
      .filter((entry) => entry.startsWith('v1,'))
      .map((entry) => entry.slice(3));
    const valid = keys.some((key) => {
      const expected = createHmac('sha256', key)
        .update(signed)
        .digest('base64');
      return candidates.some((candidate) => sameText(candidate, expected));
    });
    return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
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
