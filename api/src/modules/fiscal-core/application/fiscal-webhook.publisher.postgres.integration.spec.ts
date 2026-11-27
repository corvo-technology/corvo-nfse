import { randomUUID } from 'node:crypto';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  createPostgresHarness,
  describePostgres,
  type PostgresHarness,
} from '@/modules/nfe/testing/postgres-harness';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import { TypeormWebhookDeliveryRepository } from '@/modules/webhooks-config/infra/typeorm-webhook-delivery.repository';
import { WebhookDeliveryOrmEntity } from '@/modules/webhooks-config/infra/webhook-delivery.orm-entity';
import { WebhookDeliveryQuery } from '@/shared/http/webhook-delivery-query';
import { FiscalWebhookPublisher } from './fiscal-webhook.publisher';

describePostgres('FiscalWebhookPublisher on PostgreSQL', () => {
  let h: PostgresHarness;
  let publisher: FiscalWebhookPublisher;
  let deliveries: TypeormWebhookDeliveryRepository;
  const configId = randomUUID();
  const documentId = randomUUID();
  const invoiceId = randomUUID();

  beforeAll(async () => {
    h = await createPostgresHarness('fiscalhook');
    await h.admin.query(
      `INSERT INTO "${h.schema}".webhook_configs (id, tenant_id, url, events, secret) VALUES ($1, $2, 'https://hook.test', '{}', 'secret')`,
      [configId, h.tenantId],
    );
    deliveries = new TypeormWebhookDeliveryRepository(
      h.runtime.getRepository(WebhookDeliveryOrmEntity),
    );
    const outbox = new WebhookOutboxService(
      {} as never,
      deliveries,
      {} as never,
      {} as never,
      {} as never,
    );
    publisher = new FiscalWebhookPublisher(
      {
        findByTenantIdAndEvent: () =>
          Promise.resolve([
            {
              id: configId,
              active: true,
              url: 'https://hook.test',
              secret: 's',
            },
          ]),
      } as never,
      outbox,
    );
  }, 120000);

  afterAll(async () => {
    await h.close();
  });

  const list = (query: Partial<WebhookDeliveryQuery>) =>
    runWithTenant(h.tenantId, () =>
      deliveries.listPage(h.tenantId, { ...query }),
    );

  it('stores the document id of an nfe event, with no invoice id', async () => {
    await publisher.publish(
      {
        type: 'nfe',
        id: documentId,
        tenantId: h.tenantId,
        environment: 'test',
        companyId: h.companyId,
      },
      'nfe.document.authorized',
      { status: 'authorized' },
    );
    const rows: Array<{
      document_id: string | null;
      invoice_id: string | null;
    }> = await h.admin.query(
      `SELECT document_id, invoice_id FROM "${h.schema}".webhook_deliveries WHERE tenant_id = $1`,
      [h.tenantId],
    );
    expect(rows).toEqual([{ document_id: documentId, invoice_id: null }]);
  });

  it('filters the deliveries by document_id, and invoice_id keeps working for the NFS-e', async () => {
    await runWithTenant(h.tenantId, () =>
      deliveries.save(
        {
          id: randomUUID(),
          tenantId: h.tenantId,
          webhookConfigId: configId,
          invoiceId,
          eventType: 'nfse.invoice.authorized',
          environment: 'test',
          url: 'https://hook.test',
          payload: {
            id: 'evt_1',
            type: 'nfse.invoice.authorized',
            environment: 'test',
            createdAt: new Date().toISOString(),
            data: { invoiceId },
          },
          status: 'pending',
          retryCount: 0,
          createdAt: new Date(),
        },
        h.tenantId,
      ),
    );
    const byDocument = await list({ document_id: documentId });
    expect(byDocument.data.map((d) => d.eventType)).toEqual([
      'nfe.document.authorized',
    ]);
    expect(byDocument.data[0].documentId).toBe(documentId);
    const byInvoice = await list({ invoice_id: invoiceId });
    expect(byInvoice.data.map((d) => d.eventType)).toEqual([
      'nfse.invoice.authorized',
    ]);
    expect(byInvoice.data[0].documentId).toBeUndefined();
    expect((await list({ invoice_id: documentId })).data).toEqual([]);
    expect((await list({})).data).toHaveLength(2);
  });
});
