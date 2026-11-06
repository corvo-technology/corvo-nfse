import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreditsModule } from '@/modules/credits/credits.module';
import { WooviClient } from '@/infra/external/woovi/woovi.client';
import type { WooviConfig } from '@/infra/config/configuration.types';
import { PaymentFulfillmentService } from './application/payment-fulfillment.service';
import { CheckoutRouterService } from './application/checkout-router.service';
import { PaymentHistoryService } from './application/payment-history.service';
import { StripePaymentsService } from './application/stripe-payments.service';
import { WooviPaymentsService } from './application/woovi-payments.service';
import { PaymentIntentStore } from './domain/payment-intent';
import { PaymentIntentOrmEntity } from './infra/payment-intent.orm-entity';
import { TypeOrmPaymentIntentStore } from './infra/typeorm-payment-intent.store';
import { WOOVI_CONFIG } from './http/woovi-webhook.controller';
import { BillingUsageModule } from './billing-usage.module';
import { BillingService } from './application/billing.service';
import { BillingProvider } from './domain/billing-provider.port';
import { StripeGateway } from '@/infra/external/stripe/stripe.gateway';
import { StripeBillingAdapter } from '@/infra/external/stripe/stripe-billing.adapter';
import { PricingService } from '@/modules/plans/application/pricing.service';

@Module({
  imports: [
    BillingUsageModule,
    CreditsModule,
    TypeOrmModule.forFeature([PaymentIntentOrmEntity]),
  ],
  providers: [
    PricingService,
    StripeGateway,
    StripeBillingAdapter,
    { provide: BillingProvider, useExisting: StripeBillingAdapter },
    BillingService,
    {
      provide: WOOVI_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<WooviConfig>('woovi'),
    },
    {
      provide: WooviClient,
      inject: [WOOVI_CONFIG],
      useFactory: (config: WooviConfig) => new WooviClient(config),
    },
    { provide: PaymentIntentStore, useClass: TypeOrmPaymentIntentStore },
    PaymentFulfillmentService,
    StripePaymentsService,
    WooviPaymentsService,
    CheckoutRouterService,
    PaymentHistoryService,
  ],
  exports: [
    BillingService,
    WooviPaymentsService,
    StripePaymentsService,
    CheckoutRouterService,
    PaymentHistoryService,
    WOOVI_CONFIG,
  ],
})
export class BillingCoreModule {}
