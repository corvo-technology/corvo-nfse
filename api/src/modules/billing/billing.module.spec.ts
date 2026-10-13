import { MODULE_METADATA } from '@nestjs/common/constants';
import { BillingController } from './billing.controller';
import { BillingModule } from './billing.module';
import { StripeWebhookController } from './http/stripe-webhook.controller';

describe(BillingModule.name, () => {
  it('serves the Stripe webhook from the API runtime', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      BillingModule,
    ) as unknown[];
    expect(controllers).toEqual(
      expect.arrayContaining([BillingController, StripeWebhookController]),
    );
  });
});
