import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planEmission } from '../domain/emission-planner';
import type {
  ConnectionView,
  NormalizedOperation,
  OperationDelivery,
} from '../domain/connector';
import type { IntegrationRule } from '../domain/integration-rule';
import { PushinPayConnector } from './pushinpay/pushinpay.connector';
import { StripeConnector } from './stripe/stripe.connector';
import { WooviConnector } from './woovi/woovi.connector';

/**
 * A paid sale is never held back for a missing buyer e-mail, whatever the platform:
 * the invoice is issued and just not e-mailed, even when the connection sends e-mail.
 */
const delivery: OperationDelivery = {
  kind: 'operation',
  deliveryId: 'd',
  externalType: 'x',
};
const read = (...parts: string[]) =>
  readFileSync(join(__dirname, ...parts), 'utf8');
const view = (credentials: Record<string, string>): ConnectionView => ({
  publicId: 'pub',
  environment: 'live',
  externalAccountId: 'acc',
  credentials,
});

const rule: IntegrationRule = {
  id: 'r',
  tenantId: 't',
  connectionId: 'c',
  externalProductId: null,
  service: {},
  sendEmail: true,
  allowAnonymousCustomer: true,
  cancelOnRefund: false,
};

function plan(provider: string, operation: NormalizedOperation) {
  return planEmission({
    tenantId: 't',
    provider,
    connection: {
      id: 'c',
      companyId: 'co',
      state: 'active',
      activeFrom: null,
      environment: 'live',
      externalAccountId: 'acc',
    },
    operation: {
      snapshot: operation,
      commercialState: operation.commercialState,
    },
    rules: [rule],
  });
}

describe('invoice request without a buyer e-mail', () => {
  it('PushinPay never sends the e-mail: the invoice is issued without sending', async () => {
    const op = await new PushinPayConnector().normalize({
      connection: view({ webhookSecret: 'S', webhookToken: 'T' }),
      payload: read('pushinpay', '__fixtures__', 'pix-paid.json'),
      delivery,
    });
    expect(op.customer?.email).toBeNull();
    const result = plan('pushinpay', op);
    expect(result.kind).toBe('issue');
    if (result.kind === 'issue') expect(result.request.email).toBe(false);
  });

  it('Stripe without a billing e-mail is issued without sending', async () => {
    const event = JSON.parse(
      read('stripe', '__fixtures__', 'charge-succeeded.json'),
    ) as {
      data: { object: { billing_details: { email: unknown } } };
    };
    event.data.object.billing_details.email = null;
    const op = await new StripeConnector().normalize({
      connection: view({
        webhookSecret: 'S',
        webhookSigningSecret: 'whsec_x',
      }),
      payload: JSON.stringify(event),
      delivery,
    });
    expect(op.customer?.email).toBeNull();
    const result = plan('stripe', {
      ...op,
      customer: { ...op.customer!, taxId: '52998224725' },
    });
    expect(result.kind).toBe('issue');
    if (result.kind === 'issue') expect(result.request.email).toBe(false);
  });

  it('keeps sending when the buyer has an e-mail (Stripe fixture as it is)', async () => {
    const op = await new StripeConnector().normalize({
      connection: view({
        webhookSecret: 'S',
        webhookSigningSecret: 'whsec_x',
      }),
      payload: read('stripe', '__fixtures__', 'charge-succeeded.json'),
      delivery,
    });
    // Stripe does not give the CPF without a key: the client completed it.
    const result = plan('stripe', {
      ...op,
      customer: { ...op.customer!, taxId: '52998224725' },
    });
    expect(result.kind).toBe('issue');
    if (result.kind === 'issue') expect(result.request.email).toBe(true);
  });

  it('Woovi with a CNPJ and no e-mail is issued without sending', async () => {
    const op = await new WooviConnector({
      getKeys: jest.fn(),
    } as never).normalize({
      connection: view({}),
      payload: read(
        'woovi',
        '__fixtures__',
        'charge-completed-cnpj-no-email.json',
      ),
      delivery,
    });
    const result = plan('woovi', op);
    expect(result.kind).toBe('issue');
    if (result.kind === 'issue') expect(result.request.email).toBe(false);
  });

  it.each(['abacatepay', 'hotmart', 'kiwify', 'monetizze'])(
    '%s: a buyer with a document and no e-mail is issued without sending',
    (provider) => {
      const op: NormalizedOperation = {
        operationKey: `${provider}:1`,
        commercialState: 'paid',
        externalRefs: {},
        occurredAt: new Date('2026-11-26T15:00:00Z'),
        paidAt: new Date('2026-11-26T15:00:00Z'),
        currency: 'BRL',
        amountCents: 990,
        discountCents: 0,
        customer: {
          name: 'ACME LTDA',
          email: null,
          taxId: '11222333000181',
          taxIdMasked: false,
        },
        items: [],
        sellerIssuesInvoice: true,
      };
      const result = plan(provider, op);
      expect(result.kind).toBe('issue');
      if (result.kind === 'issue') expect(result.request.email).toBe(false);
    },
  );
});
