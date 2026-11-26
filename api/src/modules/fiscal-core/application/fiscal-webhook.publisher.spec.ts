import { FiscalWebhookPublisher } from './fiscal-webhook.publisher';
import type { DocumentRef } from '../domain/document-type';

const ref: DocumentRef & { companyId: string } = {
  type: 'nfe',
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: '11111111-1111-4111-8111-111111111111',
  environment: 'test',
  companyId: '22222222-2222-4222-8222-222222222222',
};

describe('FiscalWebhookPublisher', () => {
  it('enqueues one delivery per active subscription, with documentType and documentId', async () => {
    const outbox = { enqueue: jest.fn() };
    const webhooks = {
      findByTenantIdAndEvent: jest.fn().mockResolvedValue([
        { id: 'cfg-1', active: true, url: 'https://a.test', secret: 's1' },
        { id: 'cfg-2', active: false, url: 'https://b.test', secret: 's2' },
      ]),
    };
    const publisher = new FiscalWebhookPublisher(
      webhooks as never,
      outbox as never,
    );

    await publisher.publish(ref, 'nfe.document.authorized', {
      status: 'authorized',
      accessKey: '3'.repeat(44),
      number: 7,
      series: 1,
    });

    expect(webhooks.findByTenantIdAndEvent).toHaveBeenCalledWith(
      ref.tenantId,
      'nfe.document.authorized',
      'test',
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const sent = (outbox.enqueue.mock.calls as unknown[][])[0][0];
    expect(sent).toMatchObject({
      webhookConfigId: 'cfg-1',
      eventType: 'nfe.document.authorized',
      environment: 'test',
      payload: {
        type: 'nfe.document.authorized',
        environment: 'test',
        data: {
          documentType: 'nfe',
          documentId: ref.id,
          companyId: ref.companyId,
          status: 'authorized',
          number: 7,
        },
      },
    });
    expect(sent).not.toHaveProperty('payload.data.invoiceId');
  });

  it('swallows a failure: the fiscal fact already happened', async () => {
    const publisher = new FiscalWebhookPublisher(
      {
        findByTenantIdAndEvent: jest.fn().mockRejectedValue(new Error('down')),
      } as never,
      { enqueue: jest.fn() } as never,
    );
    await expect(
      publisher.publish(ref, 'nfe.document.denied', {}),
    ).resolves.toBeUndefined();
  });
});
