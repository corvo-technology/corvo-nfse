import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConnectorDataError,
  type Connector,
  type NormalizedOperation,
  type ParsedDelivery,
} from '../domain/connector';

/** Two connectors with deliberately different shapes. Test-only: never registered in production. */

const manifest = (id: string) => ({
  id,
  name: id,
  version: '1',
  credentialFields: [
    { key: 'secret', label: 'Secret', secret: true },
    { key: 'account', label: 'Account', secret: false },
  ],
  webhookInstructions: { pt: 'teste', en: 'test' },
  supportedFlows: ['test'],
});

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** JSON body, HMAC-SHA256 hex signature in a header, ids in the body. */
export const syntheticJsonConnector: Connector = {
  manifest: manifest('synthetic-json'),
  authenticate(req, connection) {
    const expected = createHmac('sha256', connection.credentials.secret)
      .update(req.rawBody)
      .digest('hex');
    const received = req.headers['x-synthetic-signature'];
    return Promise.resolve(
      received && safeEqual(received, expected)
        ? { ok: true }
        : { ok: false, reason: 'bad_signature' },
    );
  },
  parse(req): ParsedDelivery {
    const body = JSON.parse(req.rawBody.toString('utf8')) as {
      id: string;
      type: string;
      livemode?: boolean;
    };
    if (body.type === 'ping') return { kind: 'test' };
    if (!['payment.paid', 'payment.refunded'].includes(body.type))
      return { kind: 'ignored', externalType: body.type };
    return {
      kind: 'operation',
      deliveryId: body.id,
      externalType: body.type,
      ...(body.livemode === undefined
        ? {}
        : { environment: body.livemode ? 'live' : 'test' }),
    };
  },
  normalize({ payload }) {
    const body = JSON.parse(payload as string) as {
      type: string;
      at: string;
      charge: {
        id: string;
        cents: number;
        currency?: string;
        customer?: { name?: string; document?: string; email?: string };
      };
    };
    if (!body.charge?.id) throw new ConnectorDataError('charge.id is missing');
    const document = body.charge.customer?.document ?? null;
    const operation: NormalizedOperation = {
      operationKey: `charge:${body.charge.id}`,
      commercialState: body.type === 'payment.refunded' ? 'refunded' : 'paid',
      externalRefs: { charge: body.charge.id },
      occurredAt: new Date(body.at),
      paidAt: new Date(body.at),
      currency: body.charge.currency ?? 'BRL',
      amountCents: body.charge.cents,
      discountCents: 0,
      customer: body.charge.customer
        ? {
            name: body.charge.customer.name ?? null,
            email: body.charge.customer.email ?? null,
            taxId: document && !document.includes('*') ? document : null,
            taxIdMasked: document?.includes('*') ?? false,
          }
        : null,
      items: [],
      sellerIssuesInvoice: true,
    };
    return Promise.resolve(operation);
  },
  validateConnection: (credentials) =>
    Promise.resolve({ externalAccountId: credentials.account }),
};

/** Form-encoded body, shared token in the query string, amount as a decimal string. */
export const syntheticFormConnector: Connector = {
  manifest: manifest('synthetic-form'),
  authenticate(req, connection) {
    const token = req.query.token;
    return Promise.resolve(
      token && safeEqual(token, connection.credentials.secret)
        ? { ok: true }
        : { ok: false, reason: 'bad_token' },
    );
  },
  parse(req): ParsedDelivery {
    const form = new URLSearchParams(req.rawBody.toString('utf8'));
    const kind = form.get('kind');
    if (kind === 'test') return { kind: 'test' };
    if (kind !== 'paid' && kind !== 'refund')
      return { kind: 'ignored', externalType: kind ?? 'unknown' };
    const mode = form.get('mode');
    return {
      kind: 'operation',
      deliveryId: form.get('event_ref') ?? '',
      externalType: kind,
      ...(mode ? { environment: mode === 'sandbox' ? 'test' : 'live' } : {}),
    };
  },
  normalize({ payload }) {
    const form = new URLSearchParams(payload as string);
    const [reais, centavos = '0'] = (form.get('amount') ?? '0').split('.');
    const cpf = form.get('cpf');
    const operation: NormalizedOperation = {
      operationKey: `sale:${form.get('sale_id')}`,
      commercialState: form.get('kind') === 'refund' ? 'refunded' : 'paid',
      externalRefs: { sale: form.get('sale_id') ?? '' },
      occurredAt: new Date(form.get('when') ?? 0),
      paidAt: new Date(form.get('when') ?? 0),
      currency: 'BRL',
      amountCents: Number(reais) * 100 + Number(centavos.padEnd(2, '0')),
      discountCents: 0,
      customer: {
        name: form.get('buyer'),
        email: null,
        taxId: cpf && !cpf.includes('*') ? cpf : null,
        taxIdMasked: cpf?.includes('*') ?? false,
      },
      items: [],
      sellerIssuesInvoice: true,
    };
    return Promise.resolve(operation);
  },
  validateConnection: (credentials) =>
    Promise.resolve({ externalAccountId: credentials.account }),
};
