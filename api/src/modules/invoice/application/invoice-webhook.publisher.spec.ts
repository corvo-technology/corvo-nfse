import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import type { Invoice } from '../domain/invoice';
import { buildInvoiceState } from '../domain/invoice-state';

const invoice = {
  id: 'inv-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  companyId: 'company-1',
  environment: 'live',
  status: 'cancelled',
  documentsReadyAt: new Date(),
  emailSnapshot: { send: false },
  lastEmailStatus: null,
  state: buildInvoiceState({
    status: 'cancelled',
    documentsReady: true,
    emailRequested: false,
    emailStatus: null,
  }),
} as unknown as Invoice;

describe('InvoiceWebhookPublisher', () => {
  it('enqueues one delivery per active subscription with the invoice state', async () => {
    const outbox = { enqueue: jest.fn() };
    const configs = [
      { id: 'cfg-1', active: true, url: 'https://a.test', secret: 's1' },
      { id: 'cfg-2', active: false, url: 'https://b.test', secret: 's2' },
    ];
    const webhooks = {
      findByTenantIdAndEvent: jest.fn().mockResolvedValue(configs),
    };
    const publisher = new InvoiceWebhookPublisher(
      webhooks as never,
      outbox as never,
    );

    await publisher.publish(invoice, 'nfse.invoice.cancelled', {
      reason: 'other',
    });

    expect(webhooks.findByTenantIdAndEvent).toHaveBeenCalledWith(
      invoice.tenantId,
      'nfse.invoice.cancelled',
      invoice.environment,
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect((outbox.enqueue.mock.calls as unknown[][])[0][0]).toMatchObject({
      webhookConfigId: 'cfg-1',
      eventType: 'nfse.invoice.cancelled',
      payload: {
        type: 'nfse.invoice.cancelled',
        data: {
          invoiceId: 'inv-1',
          status: 'cancelled',
          stage: 'cancelled',
          reason: 'other',
        },
      },
    });
  });

  it('swallows delivery failures so the fiscal flow is not interrupted', async () => {
    const publisher = new InvoiceWebhookPublisher(
      {
        findByTenantIdAndEvent: jest.fn().mockRejectedValue(new Error('db')),
      } as never,
      { enqueue: jest.fn() } as never,
    );
    await expect(
      publisher.publish(invoice, 'nfse.invoice.cancelled'),
    ).resolves.toBeUndefined();
  });

  describe('email status in the payload', () => {
    async function emailPayload(
      stateOverride?: { emailStatus: 'sent' },
      lastEmailStatus: 'queued' | null = 'queued',
    ) {
      const outbox = { enqueue: jest.fn() };
      const publisher = new InvoiceWebhookPublisher(
        {
          findByTenantIdAndEvent: jest
            .fn()
            .mockResolvedValue([
              { id: 'cfg-1', active: true, url: 'https://a.test', secret: 's' },
            ]),
        } as never,
        outbox as never,
      );
      const stale = {
        ...invoice,
        status: 'authorized',
        lastEmailStatus,
        emailSnapshot: { send: true },
      } as unknown as Invoice;
      await publisher.publish(
        stale,
        'nfse.invoice.email_sent',
        {},
        stateOverride,
      );
      const [[call]] = outbox.enqueue.mock.calls as [
        [{ payload: { data: Record<string, unknown> } }],
      ];
      return call.payload.data;
    }

    it.each([['queued' as const], [null]])(
      'uses the override even when lastEmailStatus is %s',
      async (last) => {
        expect(await emailPayload({ emailStatus: 'sent' }, last)).toMatchObject(
          { emailStatus: 'sent' },
        );
      },
    );

    it('falls back to lastEmailStatus without an override', async () => {
      expect(await emailPayload(undefined, 'queued')).toMatchObject({
        emailStatus: 'queued',
      });
    });
  });
});
