import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { CreditsAlertsModule } from '@/modules/credits-alerts/credits-alerts.module';
import { EmailModule } from '@/modules/email/email.module';
import { LifecycleEmailLedger } from './infra/lifecycle-email.ledger';
import { LifecycleEmailSendOrmEntity } from './infra/lifecycle-email-send.orm-entity';
import { LifecycleStatsRepository } from './infra/lifecycle-stats.repository';
import { LifecycleEmailsService } from './lifecycle-emails.service';

/**
 * E-mails to the workspace owners along the life of the account. The service listens to events in
 * every process that imports this module; the schedules (monthly summary, payment reminder) are
 * registered by the worker only.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([LifecycleEmailSendOrmEntity]),
    AppRedisModule,
    BillingUsageModule,
    CreditsAlertsModule,
    EmailModule,
  ],
  providers: [
    LifecycleEmailLedger,
    LifecycleStatsRepository,
    LifecycleEmailsService,
  ],
  exports: [LifecycleEmailsService, CreditsAlertsModule],
})
export class LifecycleEmailsModule {}
