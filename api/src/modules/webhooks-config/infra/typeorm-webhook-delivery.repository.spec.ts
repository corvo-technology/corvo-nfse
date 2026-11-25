/* eslint-disable @typescript-eslint/no-unsafe-return -- stub of the query builder */
import { TypeormWebhookDeliveryRepository } from './typeorm-webhook-delivery.repository';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INVOICE = '22222222-2222-4222-8222-222222222222';

function setup() {
  const wheres: Array<[string, unknown]> = [];
  const query = {
    alias: 'delivery',
    where: jest.fn((sql: string, params: unknown) => {
      wheres.push([sql, params]);
      return query;
    }),
    andWhere: jest.fn((sql: string, params: unknown) => {
      wheres.push([sql, params]);
      return query;
    }),
    addSelect: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    addOrderBy: jest.fn(() => query),
    take: jest.fn(() => query),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
  };
  const repo = { createQueryBuilder: jest.fn(() => query) };
  return {
    wheres,
    repository: new TypeormWebhookDeliveryRepository(repo as never),
  };
}

const sqlOf = (wheres: Array<[string, unknown]>) =>
  wheres.map(([sql]) => sql).join(' | ');

describe('TypeormWebhookDeliveryRepository.listPage filters', () => {
  it('adds no extra condition without filters', async () => {
    const { repository, wheres } = setup();
    await repository.listPage(TENANT, {});
    expect(sqlOf(wheres)).not.toMatch(/invoice_id|event_type|status/);
  });

  it('filters by invoice, event and status, always inside the tenant', async () => {
    const { repository, wheres } = setup();
    await repository.listPage(TENANT, {
      invoice_id: INVOICE,
      event_type: 'nfse.invoice.authorized',
      status: 'failed',
    });
    expect(wheres).toEqual(
      expect.arrayContaining([
        ['delivery.tenant_id = :tenantId', { tenantId: TENANT }],
        ['delivery.invoice_id = :invoiceId', { invoiceId: INVOICE }],
        [
          'delivery.event_type = :eventType',
          { eventType: 'nfse.invoice.authorized' },
        ],
        ['delivery.status = :status', { status: 'failed' }],
      ]),
    );
  });

  it('looks back as far as asked', async () => {
    const { repository, wheres } = setup();
    const before = Date.now();
    await repository.listPage(TENANT, { hours: 720 });
    const params = wheres.find(([sql]) => sql.includes('created_at'))![1] as {
      since: string;
    };
    expect(before - new Date(params.since).getTime()).toBeGreaterThanOrEqual(
      719 * 3_600_000,
    );
  });

  it('refuses a cursor made for other filters', async () => {
    const { repository } = setup();
    const cursor = Buffer.from(
      JSON.stringify({
        v: 1,
        scope: 'other',
        sort: '2026-11-01T00:00:00.000000Z',
        id: '33333333-3333-4333-8333-333333333333',
      }),
    ).toString('base64url');
    await expect(
      repository.listPage(TENANT, { invoice_id: INVOICE, cursor }),
    ).rejects.toBeDefined();
  });
});
