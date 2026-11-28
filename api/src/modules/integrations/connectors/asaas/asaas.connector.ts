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
import { AsaasClient } from './asaas.client';

/** Header Asaas fills with the token the merchant typed when creating the webhook. */
export const ASAAS_TOKEN_HEADER = 'asaas-access-token';

const EVENT_STATE: Record<string, CommercialState> = {
  PAYMENT_CONFIRMED: 'paid',
  PAYMENT_RECEIVED: 'paid',
  PAYMENT_REFUNDED: 'refunded',
  PAYMENT_CHARGEBACK_REQUESTED: 'disputed',
};
/** `2024-06-12 16:45:03`, in Brasilia time. */
const EVENT_DATE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

interface Payment {
  id?: unknown;
  customer?: unknown;
  value?: unknown;
  description?: unknown;
  externalReference?: unknown;
  billingType?: unknown;
}
interface Envelope {
  id?: unknown;
  event?: unknown;
  dateCreated?: unknown;
  payment?: Payment | null;
}

function readBody(rawBody: Buffer): Envelope {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Asaas webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function eventDate(value: unknown): Date | null {
  const match = typeof value === 'string' ? EVENT_DATE.exec(value) : null;
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Asaas sends reais as a JSON number. */
const cents = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100)
    : null;

/**
 * Pix, boleto and card charges on an Asaas account. The webhook only names the customer, so with the
 * client's read-only key (optional) the connector looks the customer up for name, CPF/CNPJ, e-mail and address.
 * Asaas signs nothing: the token the merchant sets on the webhook (`asaas-access-token`) authenticates the call.
 */
@Injectable()
export class AsaasConnector implements Connector {
  readonly manifest = {
    id: 'asaas',
    name: 'Asaas',
    version: '1',
    credentialFields: [
      {
        key: 'access_token',
        label:
          'Chave de API do Asaas (opcional, só para consultar o cliente: nome, CPF/CNPJ, e-mail e endereço)',
        secret: true,
        optional: true,
      },
      {
        key: 'webhookToken',
        label: `Token do webhook (cabeçalho ${ASAAS_TOKEN_HEADER})`,
        secret: true,
        generate: true,
        revealOnce: true,
      },
    ],
    webhookInstructions: {
      pt: `Passo 1 (opcional, recomendado): no Asaas, em Integrações > Chaves de API, gere uma chave e cole em "Chave de API". A Corvo só consulta o cliente da cobrança (nome, CPF/CNPJ, e-mail e endereço); não cria nem altera nada. Sem a chave, as vendas ficam sem CPF/CNPJ e vão para "Vendas pendentes". Passo 2: copie o endereço do webhook e o token mostrados aqui. Passo 3: no Asaas, em Integrações > Webhooks, crie um webhook de Cobranças com esse endereço, cole o token em "Token de autenticação" e marque os eventos PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_REFUNDED e PAYMENT_CHARGEBACK_REQUESTED. Importante: mantenha desligada a emissão de nota fiscal do próprio Asaas, para a nota não sair duas vezes.`,
      en: `Step 1 (optional, recommended): in Asaas, under Integrations > API keys, generate a key and paste it in "API key". Corvo only looks up the charge's customer (name, tax ID, e-mail and address); it does not create or change anything. Without the key, sales have no tax ID and go to "Pending sales". Step 2: copy the webhook address and the token shown here. Step 3: in Asaas, under Integrations > Webhooks, create a Charges webhook with that address, paste the token in "Authentication token" and select the events PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_REFUNDED and PAYMENT_CHARGEBACK_REQUESTED. Important: keep Asaas's own invoice issuing turned off, so the invoice is not issued twice.`,
    },
    webhookEvents: [
      'PAYMENT_RECEIVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REFUNDED',
      'PAYMENT_CHARGEBACK_REQUESTED',
    ],
    supportedFlows: ['pix', 'boleto', 'credit-card'],
  };

  constructor(private readonly client: AsaasClient = new AsaasClient()) {}

  authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    return Promise.resolve(this.check(req, connection));
  }

  private check(req: InboundRequest, connection: ConnectionView): DeliveryAuth {
    const expected = connection.credentials.webhookToken;
    const sent = req.headers[ASAAS_TOKEN_HEADER];
    if (!sent) return { ok: false, reason: 'missing_token' };
    return expected && sameText(sent, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_token' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.event !== 'string') return { kind: 'test' };
    if (!EVENT_STATE[body.event])
      return { kind: 'ignored', externalType: body.event };
    const paymentId = text(body.payment?.id);
    if (!paymentId)
      throw new ConnectorDataError('Asaas event has no payment id');
    return {
      kind: 'operation',
      deliveryId: `${paymentId}:${body.event}`,
      externalType: body.event,
    };
  }

  normalize(input: {
    connection: ConnectionView;
    payload: unknown;
    delivery: OperationDelivery;
  }): Promise<NormalizedOperation> {
    // Errors must surface as rejections, like any other async connector call.
    return this.toOperation(input.payload, input.connection);
  }

  private async toOperation(
    payload: unknown,
    connection: ConnectionView,
  ): Promise<NormalizedOperation> {
    const body = readBody(Buffer.from(String(payload), 'utf8'));
    const state =
      typeof body.event === 'string' ? EVENT_STATE[body.event] : undefined;
    if (!state) throw new ConnectorDataError('Not an Asaas payment event');
    const payment = body.payment;
    const paymentId = text(payment?.id);
    if (!payment || !paymentId)
      throw new ConnectorDataError('Asaas event has no payment id');
    const amount = cents(payment.value);
    if (amount === null || amount <= 0)
      throw new ConnectorDataError('Asaas payment value is not positive');
    const at = eventDate(body.dateCreated) ?? new Date();
    const customerId = text(payment.customer);
    const externalReference = text(payment.externalReference);
    const paid = state === 'paid';
    return {
      operationKey: `asaas:${paymentId}`,
      commercialState: state,
      externalRefs: {
        paymentId,
        ...(customerId ? { customerId } : {}),
        ...(externalReference ? { externalReference } : {}),
      },
      ...(paid ? {} : { refersTo: { ref: 'paymentId', value: paymentId } }),
      occurredAt: at,
      paidAt: paid ? at : null,
      currency: 'BRL',
      amountCents: amount,
      discountCents: 0,
      customer: paid ? await this.customerOf(connection, customerId) : null,
      items: [],
      description: text(payment.description),
      sellerIssuesInvoice: true,
    };
  }

  /** Without the key (or the customer) the sale simply has no document and waits in "Vendas pendentes". */
  private async customerOf(
    connection: ConnectionView,
    customerId: string | null,
  ): Promise<NormalizedCustomer | null> {
    const accessToken = connection.credentials.access_token;
    if (!accessToken || !customerId) return null;
    try {
      const customer = await this.client.getCustomer(
        accessToken,
        connection.environment,
        customerId,
      );
      return {
        name: customer.name,
        email: customer.email,
        taxId: normalizeTaxID(customer.cpfCnpj ?? undefined) ?? null,
        taxIdMasked: false,
        ...(Object.keys(customer.address).length > 0
          ? { address: customer.address }
          : {}),
      };
    } catch (error) {
      // Only a customer that cannot be read (deleted, not found) is tolerated; a refused key or a
      // transient failure stops the sale so it is retried or the key replaced.
      if (error instanceof ConnectorDataError) return null;
      throw error;
    }
  }

  async validateConnection(
    credentials: Record<string, string>,
    environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string }> {
    if (credentials.access_token)
      await this.client.checkCredentials(credentials.access_token, environment);
    // Asaas names nothing about the account in a way the webhook can be matched to, so the id comes
    // from the connection's own token.
    const digest = createHash('sha256')
      .update(credentials.webhookToken ?? '')
      .digest('hex');
    return { externalAccountId: `asaas:${digest.slice(0, 24)}` };
  }
}
