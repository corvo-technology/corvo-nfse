import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizeTaxID } from '@/shared/tax-id';
import {
  ConnectorAuthError,
  ConnectorCredentialRejected,
  ConnectorDataError,
  ConnectorTransientError,
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
import {
  StripeClient,
  type StripeSaleLine,
  type StripeTaxId,
} from './stripe.client';

const MAX_LOOKUPS = 5;
const TIMESTAMP_TOLERANCE_SECONDS = 300;
const CHARGE_EVENT_STATE: Record<string, CommercialState> = {
  'charge.succeeded': 'paid',
  'charge.refunded': 'refunded',
};
const DISPUTE_EVENT = 'charge.dispute.created';
const BRAZILIAN_TAX_ID_TYPES = new Set(['br_cpf', 'br_cnpj']);

interface Charge {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  paid?: unknown;
  refunded?: unknown;
  created?: unknown;
  customer?: unknown;
  payment_intent?: unknown;
  invoice?: unknown;
  billing_details?: { name?: unknown; email?: unknown } | null;
}
interface Dispute {
  amount?: unknown;
  currency?: unknown;
  charge?: unknown;
  created?: unknown;
}
interface Envelope {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  livemode?: unknown;
  account?: unknown;
  data?: { object?: Charge & Dispute } | null;
}

function readBody(rawBody: Buffer): Envelope {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Stripe webhook body is not an object');
  return parsed;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** An id field is either the id itself or the expanded object. */
function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id ? id : null;
}

function seconds(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

function brazilianTaxId(ids: StripeTaxId[]): string | null {
  const found = ids.find((id) => BRAZILIAN_TAX_ID_TYPES.has(id.type));
  return (found && normalizeTaxID(found.value)) || null;
}

/**
 * Card, Pix and boleto payments on a Stripe account, one Charge at a time (Checkout, Payment Links,
 * subscriptions and Pix all end in a charge). Read-only: the client's restricted key only looks things up.
 */
@Injectable()
export class StripeConnector implements Connector {
  readonly manifest = {
    id: 'stripe',
    name: 'Stripe',
    version: '1',
    credentialFields: [
      {
        key: 'apiKey',
        label:
          'Chave restrita do Stripe (rk_..., só leitura). Não use a chave secreta (sk_)',
        secret: true,
        optional: true,
      },
      {
        key: 'webhookSigningSecret',
        label: 'Segredo de assinatura do webhook (whsec_...)',
        secret: true,
        optional: true,
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
      pt: 'Passo 1 (opcional): no Stripe, em Desenvolvedores > Chaves de API, crie uma chave restrita (rk_) só de leitura, com leitura em Charges, Customers, Checkout Sessions e Invoices, e cole em "Chave restrita". Não use a chave secreta (sk_). A Corvo só consulta CPF/CNPJ, e-mail e itens da venda; não consegue cobrar, estornar nem alterar nada. Sem a chave, vendas sem CPF/CNPJ vão para "Vendas pendentes". Passo 2: copie o endereço do webhook mostrado aqui. Passo 3: no Stripe, em Desenvolvedores > Webhooks, adicione um endpoint com esse endereço e os eventos charge.succeeded, charge.refunded e charge.dispute.created. Passo 4: o Stripe mostra o segredo de assinatura (whsec_...) do endpoint; copie e cole aqui para ativar. Para a nota sair completa, ligue "Coletar CPF/CNPJ" (tax_id_collection) no Checkout.',
      en: 'Step 1 (optional): in Stripe, under Developers > API keys, create a read-only restricted key (rk_) with read access to Charges, Customers, Checkout Sessions and Invoices and paste it in "Restricted key". Do not use the secret key (sk_). Corvo only looks up the tax ID, e-mail and sale items; it cannot charge, refund or change anything. Without the key, sales missing a tax ID go to "Pending sales". Step 2: copy the webhook address shown here. Step 3: in Stripe, under Developers > Webhooks, add an endpoint with that address and the events charge.succeeded, charge.refunded and charge.dispute.created. Step 4: Stripe shows the endpoint signing secret (whsec_...); copy it and paste it here to activate. For a complete invoice, turn on tax ID collection (tax_id_collection) in Checkout.',
    },
    webhookEvents: [
      'charge.succeeded',
      'charge.refunded',
      'charge.dispute.created',
    ],
    supportedFlows: ['charge'],
  };

  /** The restricted key is optional: without it the account stays unidentified. */
  readonly accountIdOptional = true;

  constructor(private readonly client: StripeClient = new StripeClient()) {}

  /** A full-access secret key (sk_) is refused, never stored. */
  checkCredentials(credentials: Record<string, string>): void {
    if (credentials.apiKey?.trim().startsWith('sk_'))
      throw new ConnectorCredentialRejected(
        'STRIPE_SECRET_KEY_REJECTED',
        'Do not use the Stripe secret key (sk_). Create a read-only restricted key (rk_) instead.',
      );
  }

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
    const header = req.headers['stripe-signature'];
    if (!header) return { ok: false, reason: 'missing_signature' };
    const signingSecret = connection.credentials.webhookSigningSecret;
    if (!signingSecret) return { ok: false, reason: 'bad_signature' };

    let timestamp: string | undefined;
    const candidates: string[] = [];
    for (const part of header.split(',')) {
      const [key, ...rest] = part.trim().split('=');
      const value = rest.join('=');
      if (key === 't') timestamp = value;
      else if (key === 'v1' && value) candidates.push(value);
    }
    const signedAt = Number(timestamp);
    if (!timestamp || !Number.isInteger(signedAt) || candidates.length === 0)
      return { ok: false, reason: 'bad_signature' };
    if (Math.abs(Date.now() / 1000 - signedAt) > TIMESTAMP_TOLERANCE_SECONDS)
      return { ok: false, reason: 'stale_timestamp' };
    const expected = createHmac('sha256', signingSecret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), req.rawBody]))
      .digest('hex');
    return candidates.some((candidate) => sameText(candidate, expected))
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.type !== 'string') return { kind: 'test' };
    const object = body.data?.object;
    const wanted =
      body.type === DISPUTE_EVENT ||
      (body.type === 'charge.succeeded' &&
        object?.status === 'succeeded' &&
        object.paid === true) ||
      (body.type === 'charge.refunded' && object?.refunded === true);
    if (!wanted) return { kind: 'ignored', externalType: body.type };
    if (typeof body.id !== 'string' || !body.id)
      throw new ConnectorDataError('Stripe webhook has no id');
    return {
      kind: 'operation',
      deliveryId: body.id,
      externalType: body.type,
      ...(typeof body.livemode === 'boolean'
        ? { environment: body.livemode ? 'live' : 'test' }
        : {}),
      ...(typeof body.account === 'string' && body.account
        ? { externalAccountId: body.account }
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
    const object = body.data?.object;
    if (body.type === DISPUTE_EVENT) return this.toDispute(object, body);
    const state =
      typeof body.type === 'string' ? CHARGE_EVENT_STATE[body.type] : undefined;
    if (!state) throw new ConnectorDataError('Not a Stripe charge event');
    const chargeId = idOf(object);
    if (!object || !chargeId)
      throw new ConnectorDataError('Stripe event has no charge id');
    const amount = object.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)
      throw new ConnectorDataError(
        'Stripe amount is not a positive integer number of cents',
      );
    const created = seconds(object.created) ?? new Date();
    const found = await this.lookups(object, apiKey);
    return {
      operationKey: `stripe_charge:${chargeId}`,
      commercialState: state,
      externalRefs: {
        chargeId,
        ...(idOf(object.payment_intent)
          ? { paymentIntentId: idOf(object.payment_intent)! }
          : {}),
      },
      occurredAt:
        state === 'paid' ? created : (seconds(body.created) ?? created),
      paidAt: created,
      currency: (text(object.currency) ?? 'brl').toUpperCase(),
      amountCents: amount,
      discountCents: 0,
      customer: found.customer,
      items: found.lines.map((line) => ({
        externalProductId: line.productId,
        description: line.description,
        quantity: line.quantity,
      })),
      description: found.description,
      sellerIssuesInvoice: true,
    };
  }

  /** A dispute only names the charge: the handler swaps in that sale's own data. */
  private toDispute(
    object: Dispute | undefined,
    body: Envelope,
  ): NormalizedOperation {
    const chargeId = idOf(object?.charge);
    if (!object || !chargeId)
      throw new ConnectorDataError('Stripe dispute has no charge id');
    const amount = object.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)
      throw new ConnectorDataError(
        'Stripe dispute amount is not a positive integer number of cents',
      );
    const at = seconds(body.created) ?? seconds(object.created) ?? new Date();
    return {
      operationKey: `stripe_charge:${chargeId}`,
      commercialState: 'disputed',
      externalRefs: { chargeId },
      refersTo: { ref: 'chargeId', value: chargeId },
      occurredAt: at,
      paidAt: null,
      currency: (text(object.currency) ?? 'brl').toUpperCase(),
      amountCents: amount,
      discountCents: 0,
      customer: null,
      items: [],
      description: null,
      sellerIssuesInvoice: true,
    };
  }

  /**
   * Customer, document and items from the client's Stripe account. The key needs to read customers
   * (a refusal asks for a new key); a key that cannot read sessions or invoices only costs the description.
   */
  private async lookups(
    charge: Charge,
    apiKey: string | undefined,
  ): Promise<{
    customer: NormalizedCustomer | null;
    lines: StripeSaleLine[];
    description: string | null;
  }> {
    let name = text(charge.billing_details?.name);
    let email = text(charge.billing_details?.email);
    let taxId: string | null = null;
    let lines: StripeSaleLine[] = [];
    const customerId = idOf(charge.customer);
    const paymentIntentId = idOf(charge.payment_intent);
    const invoiceId = idOf(charge.invoice);
    if (apiKey) {
      if (customerId) {
        try {
          const customer = await this.client.getCustomer(apiKey, customerId);
          name ??= customer.name;
          email ??= customer.email;
          taxId = brazilianTaxId(customer.taxIds);
        } catch (error) {
          if (!(error instanceof ConnectorDataError)) throw error;
        }
      }
      if (paymentIntentId) {
        const session = await this.optional(() =>
          this.client.findCheckoutSession(apiKey, paymentIntentId, MAX_LOOKUPS),
        );
        taxId ??= session ? brazilianTaxId(session.taxIds) : null;
        lines = session?.lines ?? [];
      }
      if (lines.length === 0 && invoiceId)
        lines =
          (await this.optional(() =>
            this.client.getInvoiceLines(apiKey, invoiceId, MAX_LOOKUPS),
          )) ?? [];
    }
    const names = [
      ...new Set(lines.map((line) => line.description).filter(Boolean)),
    ] as string[];
    return {
      customer:
        name || email || taxId
          ? { name, email, taxId, taxIdMasked: false }
          : null,
      lines,
      description: names.length ? names.join(', ') : null,
    };
  }

  /** Only a transient failure stops the sale: without permission or data the description is just missing. */
  private async optional<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ConnectorTransientError) throw error;
      if (
        error instanceof ConnectorAuthError ||
        error instanceof ConnectorDataError
      )
        return null;
      throw error;
    }
  }

  async validateConnection(
    credentials: Record<string, string>,
    _environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string | null }> {
    // Without a key there is nothing to ask Stripe: the account stays unidentified.
    if (!credentials.apiKey) return { externalAccountId: null };
    return {
      externalAccountId: await this.client.getAccountId(credentials.apiKey),
    };
  }
}
