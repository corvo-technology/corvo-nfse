import { BillingCoreModule } from './billing-core.module';
import { BillingUsageModule } from './billing-usage.module';
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './http/stripe-webhook.controller';
import { StripeWebhookRateLimitGuard } from './http/stripe-webhook-rate-limit.guard';
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
  controllers: [BillingController, StripeWebhookController],
  // Same pattern as PlansModule: the limiter is provided where it is used.
  providers: [RedisRateLimiter, StripeWebhookRateLimitGuard],
})
export class BillingModule {}
