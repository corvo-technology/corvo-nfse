import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WebhookDeliveryQuery } from './webhook-delivery-query';

const check = (query: Record<string, unknown>) =>
  validate(plainToInstance(WebhookDeliveryQuery, query));

describe('WebhookDeliveryQuery', () => {
  it('accepts the filters', async () => {
    expect(
      await check({
        hours: '720',
        invoice_id: '22222222-2222-4222-8222-222222222222',
        event_type: 'nfse.invoice.authorized',
        status: 'failed',
        environment: 'live',
      }),
    ).toHaveLength(0);
  });

  it('keeps the period at 30 days or less', async () => {
    expect(await check({ hours: '721' })).toHaveLength(1);
    expect(await check({ hours: 0 })).toHaveLength(1);
  });

  it.each([
    { invoice_id: 'abc' },
    { status: 'broken' },
    { event_type: "x'; drop table" },
  ])('refuses %j', async (query) => {
    expect(await check(query)).toHaveLength(1);
  });
});
