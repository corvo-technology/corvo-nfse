import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ConnectorDataError,
  type CommercialState,
  type Connector,
  type ConnectionView,
  type DeliveryAuth,
  type InboundRequest,
  type NormalizedOperation,
  type OperationDelivery,
  type ParsedDelivery,
} from '../../domain/connector';
import {
  brasiliaDate,
  isOtherPartySale,
  readBody,
  readCurrency,
  readCustomer,
  readMyShareCents,
  readProduct,
  readTotalCents,
  text,
  type KiwifyBody,
} from './kiwify.payload';

/** webhook_event_type -> the order_status Kiwify sends with it, and what the sale becomes. */
const EVENTS: Record<string, { orderStatus: string; state: CommercialState }> =
  {
    order_approved: { orderStatus: 'paid', state: 'paid' },
    order_refunded: { orderStatus: 'refunded', state: 'refunded' },
    chargeback: { orderStatus: 'chargedback', state: 'disputed' },
  };

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Sales on a Kiwify account. Kiwify signs the raw body with HMAC-SHA1 (key = the webhook token, hex in
 * `?signature=`) and has no timestamp, so a replay is stopped by the delivery id (order_id + event type).
 */
@Injectable()
export class KiwifyConnector implements Connector {
  readonly manifest = {
    id: 'kiwify',
    name: 'Kiwify',
    version: '1',
    credentialFields: [
      {
        key: 'token',
        label: 'Token do webhook (o mesmo que você digitar na Kiwify)',
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
        options: ['total', 'mine'],
      },
    ],
    webhookInstructions: {
      pt: 'Na Kiwify, passo 1: abra Apps > Webhooks e crie um webhook com o endereço acima, escolhendo os produtos. Não inclua vendas de afiliados nem de coprodução: a nota é só das suas vendas. Passo 2: escolha um token (longo e aleatório), cole o mesmo token aqui na Corvo e marque os eventos Compra aprovada, Compra reembolsada e Chargeback. Passo 3: use "Testar Webhook" para conferir. A Kiwify não tem modo de teste: o teste manda dados fictícios, então faça-o numa conexão de teste da Corvo.',
      en: 'In Kiwify, step 1: open Apps > Webhooks and create a webhook with the address above, choosing the products. Do not include affiliate or co-production sales: the invoice covers your own sales only. Step 2: pick a token (long and random), paste the same token in Corvo and tick the events Approved purchase, Refunded purchase and Chargeback. Step 3: use "Test Webhook" to check. Kiwify has no test mode: the test sends fake data, so run it on a Corvo test connection.',
    },
    supportedFlows: ['order'],
  };

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const urlSecret = req.query.webhookSecret;
    const knownSecret = connection.credentials.webhookSecret;
    if (!urlSecret || !knownSecret || !sameText(urlSecret, knownSecret))
      return { ok: false, reason: 'bad_secret' };
    const signature = req.query.signature;
    if (!signature) return { ok: false, reason: 'missing_signature' };
    const token = connection.credentials.token;
    // Without a token the signature proves nothing (Kiwify would sign with an empty key).
    if (!token) return { ok: false, reason: 'bad_signature' };
    const expected = createHmac('sha1', token)
      .update(req.rawBody)
      .digest('hex');
    return sameText(signature, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    const type = text(body.webhook_event_type);
    if (!type) return { kind: 'test' };
    const wanted = EVENTS[type];
    if (!wanted || text(body.order_status) !== wanted.orderStatus)
      return { kind: 'ignored', externalType: type };
    if (isOtherPartySale(body))
      return { kind: 'ignored', externalType: `${type}:not_producer` };
    const orderId = text(body.order_id);
    if (!orderId)
      throw new ConnectorDataError('Kiwify webhook has no order_id');
    return {
      kind: 'operation',
      deliveryId: `${orderId}:${type}`,
      externalType: type,
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    try {
      return Promise.resolve(
        this.toOperation(
          readBody(Buffer.from(String(input.payload), 'utf8')),
          input.connection.credentials.invoiceValue,
        ),
      );
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }

  private toOperation(
    body: KiwifyBody,
    invoiceValue: string | undefined,
  ): NormalizedOperation {
    const event = EVENTS[text(body.webhook_event_type) ?? ''];
    if (!event) throw new ConnectorDataError('Not a Kiwify order event');
    const orderId = text(body.order_id);
    if (!orderId) throw new ConnectorDataError('Kiwify event has no order_id');
    const orderRef = text(body.order_ref);
    const subscriptionId = text(body.subscription_id);
    const externalRefs: Record<string, string> = {
      orderId,
      ...(orderRef ? { orderRef } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
    };
    const operationKey = `kiwify:${orderId}`;

    if (event.state !== 'paid') {
      // A refund or chargeback names the order: the handler swaps in that sale's own data.
      return {
        operationKey,
        commercialState: event.state,
        externalRefs,
        refersTo: { ref: 'orderId', value: orderId },
        occurredAt:
          brasiliaDate(body.updated_at) ??
          brasiliaDate(body.approved_date) ??
          new Date(),
        paidAt: null,
        currency: readCurrency(body),
        amountCents: readTotalCents(body) ?? 0,
        discountCents: 0,
        customer: null,
        items: [],
        description: null,
        sellerIssuesInvoice: true,
      };
    }

    const useMyShare = invoiceValue === 'mine';
    const amount = useMyShare ? readMyShareCents(body) : readTotalCents(body);
    if (!amount)
      throw new ConnectorDataError(
        useMyShare
          ? 'Kiwify did not send the producer share (Commissions.my_commission): complete the sale by hand'
          : 'Kiwify amount is not a positive integer number of cents',
      );
    const product = readProduct(body);
    const paidAt =
      brasiliaDate(body.approved_date) ??
      brasiliaDate(body.created_at) ??
      new Date();
    return {
      operationKey,
      commercialState: 'paid',
      externalRefs,
      occurredAt: paidAt,
      paidAt,
      currency: readCurrency(body),
      amountCents: amount,
      discountCents: 0,
      customer: readCustomer(body),
      items: [
        {
          externalProductId: product.id,
          description: product.name,
          quantity: 1,
        },
      ],
      description: product.name,
      sellerIssuesInvoice: true,
    };
  }

  /** Kiwify has no API for us to call: the connection is identified by its own public id. */
  validateConnection(
    credentials: Record<string, string>,
    _environment: unknown,
    connection: { publicId: string },
  ): Promise<{ externalAccountId: string }> {
    if (!credentials.token?.trim())
      return Promise.reject(new ConnectorDataError('Kiwify token is empty'));
    if (
      credentials.invoiceValue &&
      !['total', 'mine'].includes(credentials.invoiceValue)
    )
      return Promise.reject(
        new ConnectorDataError('invoiceValue must be total or mine'),
      );
    const digest = createHash('sha256')
      .update(connection.publicId)
      .digest('hex');
    return Promise.resolve({
      externalAccountId: `kiwify:${digest.slice(0, 24)}`,
    });
  }
}
