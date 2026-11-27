import { Module } from '@nestjs/common';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { EmailModule } from '@/modules/email/email.module';
import { AccountNoticeListener } from './account-notice.listener';
import { CreditsLowNotifier } from './credits-low.notifier';
import { CreditsPace } from './credits-pace.service';
import { LifecycleEmailSettings } from './lifecycle-email.settings';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { TenantRecipientsService } from './tenant-recipients.service';

/** API-only: listens to credit usage events. The worker never publishes them. */
@Module({
  imports: [AppRedisModule, AuthModule, BillingUsageModule, EmailModule],
  providers: [
    ...(IS_SELF_HOSTED ? [] : [CreditsLowNotifier]),
    AccountNoticeListener,
    TenantRecipientsService,
    CreditsPace,
    LifecycleEmailSettings,
  ],
  exports: [TenantRecipientsService, LifecycleEmailSettings],
})
export class CreditsAlertsModule {}
