import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { BillingService } from '../application/billing.service';
import {
  MAX_STRIPE_WEBHOOK_BODY_BYTES,
  StripeWebhookController,
} from './stripe-webhook.controller';

function setup() {
  const billing = { webhook: jest.fn().mockResolvedValue(undefined) };
  const controller = new StripeWebhookController(
    billing as unknown as BillingService,
  );
  return { billing, controller };
}
const request = (rawBody?: Buffer) => ({ rawBody }) as never;

describe(StripeWebhookController.name, () => {
  it('rejects a missing signature', async () => {
    const { controller, billing } = setup();
    await expect(
      controller.receive(request(Buffer.from('{}')), undefined as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(billing.webhook).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body', async () => {
    const { controller, billing } = setup();
    await expect(
      controller.receive(request(undefined), 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(billing.webhook).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before touching billing', async () => {
    const { controller, billing } = setup();
    const body = Buffer.alloc(MAX_STRIPE_WEBHOOK_BODY_BYTES + 1, 'a');
    await expect(
      controller.receive(request(body), 'sig'),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(billing.webhook).not.toHaveBeenCalled();
  });

  it('hands a valid request to billing and acknowledges it', async () => {
    const { controller, billing } = setup();
    const body = Buffer.from('{"id":"evt_1"}');
    await expect(controller.receive(request(body), 'sig')).resolves.toEqual({
      received: true,
    });
    expect(billing.webhook).toHaveBeenCalledWith(body, 'sig');
  });
});
