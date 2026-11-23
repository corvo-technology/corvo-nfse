import { BillingCoreModule } from './billing-core.module';
import { BillingUsageModule } from './billing-usage.module';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './http/stripe-webhook.controller';
import { WooviWebhookController } from './http/woovi-webhook.controller';
import { StripeWebhookRateLimitGuard } from './http/stripe-webhook-rate-limit.guard';
import { BillingDisabledController } from './http/billing-disabled.controller';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { PlansModule } from '@/modules/plans/plans.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { CompanyModule } from '@/modules/company/company.module';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';

@Module({
  imports: [
    BillingCoreModule,
    BillingUsageModule,
    PlansModule,
    CreditsModule,
    CompanyModule,
  ],
  controllers: IS_SELF_HOSTED
    ? [BillingDisabledController]
    : [BillingController, StripeWebhookController, WooviWebhookController],
  // Same pattern as PlansModule: the limiter is provided where it is used.
  providers: IS_SELF_HOSTED
    ? []
    : [RedisRateLimiter, StripeWebhookRateLimitGuard],
})
export class BillingModule {}
