import { Module } from '@nestjs/common';
import { BillingUsageModule } from './billing-usage.module';
import { BillingService } from './application/billing.service';
import { OverageReportService } from './application/overage-report.service';
import { BillingProvider } from './domain/billing-provider.port';
import { StripeGateway } from '@/infra/external/stripe/stripe.gateway';
import { StripeBillingAdapter } from '@/infra/external/stripe/stripe-billing.adapter';
import { PricingService } from '@/modules/plans/application/pricing.service';

@Module({
  imports: [BillingUsageModule],
  providers: [
    PricingService,
    StripeGateway,
    StripeBillingAdapter,
    { provide: BillingProvider, useExisting: StripeBillingAdapter },
    BillingService,
    OverageReportService,
  ],
  exports: [BillingService, OverageReportService],
})
export class BillingCoreModule {}
