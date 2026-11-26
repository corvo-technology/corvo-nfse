import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeTaxID } from '@/shared/tax-id';
import {
  ConnectorDataError,
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

/** Name of the custom header the merchant sets in the PushinPay panel. */
export const PUSHINPAY_TOKEN_HEADER = 'x-corvo-token';

interface PushinPayWebhook {
  id?: unknown;
  value?: unknown;
  status?: unknown;
  end_to_end_id?: unknown;
  payer_name?: unknown;
  payer_national_registration?: unknown;
  subscription_id?: unknown;
  installment_number?: unknown;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(rawBody: Buffer): PushinPayWebhook {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('PushinPay webhook body is not an object');
  return parsed;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function toCustomer(body: PushinPayWebhook): NormalizedCustomer | null {
  const name = text(body.payer_name);
  const raw = text(body.payer_national_registration);
  if (!name && !raw) return null;
  const masked = raw?.includes('*') ?? false;
  return {
    name,
    // PushinPay does not send the buyer's e-mail.
    email: null,
    taxId: masked ? null : (normalizeTaxID(raw ?? undefined) ?? null),
    taxIdMasked: masked,
  };
}

/**
 * Pix, boleto and recurring Pix charges on a PushinPay account, by webhook only
 * (their API allows one request per minute, so nothing is ever looked up).
 * PushinPay signs nothing: a secret in the URL plus a header token authenticate the call.
 */
@Injectable()
export class PushinPayConnector implements Connector {
  readonly manifest = {
    id: 'pushinpay',
    name: 'PushinPay',
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
        key: 'webhookToken',
        label: `Token do webhook (cabeçalho ${PUSHINPAY_TOKEN_HEADER})`,
        secret: true,
        generate: true,
        revealOnce: true,
      },
    ],
    webhookInstructions: {
      pt: `1) Copie o endereço do webhook da Corvo e envie-o como webhook_url ao criar cada cobrança no seu sistema (Pix, boleto ou recorrente). 2) No painel da PushinPay, configure o cabeçalho personalizado ${PUSHINPAY_TOKEN_HEADER} com o token mostrado aqui. 3) Envie um teste. A PushinPay não informa o e-mail do comprador, então a nota não é enviada ao cliente automaticamente.`,
      en: `1) Copy the Corvo webhook address and pass it as webhook_url when creating each charge in your system (Pix, boleto or recurring). 2) In the PushinPay panel, set the custom header ${PUSHINPAY_TOKEN_HEADER} to the token shown here. 3) Send a test. PushinPay does not send the buyer's email, so the invoice is not emailed to the customer automatically.`,
    },
    supportedFlows: ['pix', 'boleto', 'pix-recurring'],
  };

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const secret = req.query.webhookSecret;
    const expectedSecret = connection.credentials.webhookSecret;
    if (!secret || !expectedSecret || !sameText(secret, expectedSecret))
      return { ok: false, reason: 'bad_secret' };
    // When the connection has a header token, the call must carry it too.
    const token = connection.credentials.webhookToken;
    if (token) {
      const sent = req.headers[PUSHINPAY_TOKEN_HEADER];
      if (!sent || !sameText(sent, token))
        return { ok: false, reason: 'bad_token' };
    }
    return { ok: true };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    const id = text(body.id);
    const status = text(body.status);
    if (!id || !status) return { kind: 'test' };
    if (status !== 'paid' && status !== 'canceled')
      return { kind: 'ignored', externalType: status };
    return {
      kind: 'operation',
      deliveryId: `${id}:${status}`,
      externalType: status,
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
    const id = text(body.id);
    if (!id) throw new ConnectorDataError('PushinPay webhook has no id');
    if (body.status !== 'paid' && body.status !== 'canceled')
      throw new ConnectorDataError('Not a PushinPay payment event');
    if (!Number.isInteger(body.value) || (body.value as number) <= 0)
      throw new ConnectorDataError(
        'PushinPay value is not a positive integer number of cents',
      );
    // PushinPay sends no event time: the receipt time stands in.
    const at = new Date();
    const base = {
      operationKey: `pushinpay:${id}`,
      currency: 'BRL',
      amountCents: body.value as number,
      discountCents: 0,
      occurredAt: at,
      items: [],
      description: null,
      sellerIssuesInvoice: true,
    };
    if (body.status === 'canceled')
      // Only matters if that charge was paid (the handler ignores it otherwise).
      // A partial refund cannot be told apart: a cancellation after payment is a full refund.
      return {
        ...base,
        commercialState: 'refunded',
        externalRefs: {},
        refersTo: { ref: 'transactionId', value: id },
        paidAt: null,
        customer: null,
      };
    const endToEndId = text(body.end_to_end_id);
    const subscriptionId = text(body.subscription_id);
    const installment =
      typeof body.installment_number === 'number' ||
      typeof body.installment_number === 'string'
        ? String(body.installment_number)
        : null;
    return {
      ...base,
      commercialState: 'paid',
      externalRefs: {
        transactionId: id,
        ...(endToEndId ? { endToEndId } : {}),
        ...(subscriptionId ? { subscriptionId } : {}),
        ...(subscriptionId && installment
          ? { installmentNumber: installment }
          : {}),
      },
      paidAt: at,
      customer: toCustomer(body),
    };
  }

  validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
    connection: { publicId: string },
  ): Promise<{ externalAccountId: string }> {
    // Nothing to ask PushinPay: the account id comes from the connection's own secret.
    const digest = createHash('sha256')
      .update(credentials.webhookSecret || connection.publicId)
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `pushinpay:${digest.slice(0, 24)}`,
    });
  }
}
