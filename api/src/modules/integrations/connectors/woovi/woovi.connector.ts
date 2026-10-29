import { createHash, createVerify } from 'node:crypto';
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
import { WooviClient } from './woovi.client';
import { WooviPublicKeyProvider } from './woovi-public-key.provider';

const PAID_EVENTS = new Set([
  'OPENPIX:CHARGE_COMPLETED',
  'OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER',
]);

interface WooviTaxId {
  taxID?: string;
}
interface WooviCustomer {
  name?: string;
  email?: string;
  taxID?: string | WooviTaxId;
}
interface WooviWebhook {
  event?: string;
  charge?: {
    value?: unknown;
    correlationID?: string;
    transactionID?: string;
    updatedAt?: string;
    customer?: WooviCustomer;
  };
  pix?: { time?: string; transactionID?: string };
}

function readBody(rawBody: Buffer): WooviWebhook {
  const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new ConnectorDataError('Woovi webhook body is not an object');
  return parsed;
}

function verifies(rawBody: Buffer, signature: string, publicKey: string) {
  try {
    return createVerify('sha256')
      .update(rawBody)
      .verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

function toCustomer(
  customer: WooviCustomer | undefined,
): NormalizedCustomer | null {
  if (!customer) return null;
  const raw =
    typeof customer.taxID === 'string' ? customer.taxID : customer.taxID?.taxID;
  const masked = raw?.includes('*') ?? false;
  return {
    name: customer.name ?? null,
    email: customer.email ?? null,
    taxId: masked ? null : (normalizeTaxID(raw) ?? null),
    taxIdMasked: masked,
  };
}

/** Pix charges on a Woovi (OpenPix) account. Reads `docs/…/woovi/__fixtures__/README.md` for what is still unconfirmed. */
@Injectable()
export class WooviConnector implements Connector {
  readonly manifest = {
    id: 'woovi',
    name: 'Woovi',
    version: '1',
    credentialFields: [{ key: 'appId', label: 'AppID', secret: true }],
    webhookInstructions: {
      pt: 'No painel da Woovi, em API/Plugins, crie um webhook com a URL desta conexão e marque o evento Cobrança paga (OPENPIX:CHARGE_COMPLETED).',
      en: 'In the Woovi dashboard, under API/Plugins, create a webhook with this connection URL and select the paid charge event (OPENPIX:CHARGE_COMPLETED).',
    },
    supportedFlows: ['pix-charge'],
  };

  constructor(
    private readonly keys: WooviPublicKeyProvider,
    private readonly client: WooviClient,
  ) {}

  async authenticate(
    req: InboundRequest,
    connection: ConnectionView,
  ): Promise<DeliveryAuth> {
    const signature = req.headers['x-webhook-signature'];
    if (!signature) return { ok: false, reason: 'missing_signature' };
    const check = (list: string[]) =>
      list.some((key) => verifies(req.rawBody, signature, key));
    if (check(await this.keys.getKeys(connection.environment)))
      return { ok: true };
    // A failure may just mean Woovi rotated its key; look once more.
    if (check(await this.keys.getKeys(connection.environment, true)))
      return { ok: true };
    return { ok: false, reason: 'bad_signature' };
  }

  parse(req: InboundRequest): ParsedDelivery {
    const body = readBody(req.rawBody);
    if (typeof body.event !== 'string') return { kind: 'test' };
    if (!PAID_EVENTS.has(body.event))
      return { kind: 'ignored', externalType: body.event };
    const correlationId = body.charge?.correlationID;
    if (!correlationId)
      throw new ConnectorDataError('Woovi charge has no correlationID');
    return {
      kind: 'operation',
      deliveryId: `${body.event}:${correlationId}:${body.pix?.transactionID ?? body.charge?.transactionID ?? ''}`,
      externalType: body.event,
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
    const charge = body.charge;
    if (!charge?.correlationID)
      throw new ConnectorDataError('Woovi charge has no correlationID');
    if (!Number.isInteger(charge.value))
      throw new ConnectorDataError(
        'Woovi charge value is not an integer number of cents',
      );
    const paidAt = new Date(body.pix?.time ?? charge.updatedAt ?? Date.now());
    return {
      operationKey: `charge:${charge.correlationID}`,
      commercialState: 'paid',
      externalRefs: {
        chargeCorrelationId: charge.correlationID,
        ...(charge.transactionID
          ? { chargeTransactionId: charge.transactionID }
          : {}),
        ...(body.pix?.transactionID
          ? { pixTransactionId: body.pix.transactionID }
          : {}),
      },
      occurredAt: paidAt,
      paidAt,
      currency: 'BRL',
      amountCents: charge.value as number,
      discountCents: 0,
      // The Pix payer is deliberately not used: only the charge customer is the buyer.
      customer: toCustomer(charge.customer),
      items: [],
      sellerIssuesInvoice: true,
    };
  }

  async validateConnection(
    credentials: Record<string, string>,
    environment: IntegrationEnvironment,
  ): Promise<{ externalAccountId: string }> {
    await this.client.checkCredentials(credentials.appId, environment);
    // Woovi does not tell the account from the AppID, so the id is derived from it.
    const digest = createHash('sha256').update(credentials.appId).digest('hex');
    return { externalAccountId: `woovi:${digest.slice(0, 24)}` };
  }
}
