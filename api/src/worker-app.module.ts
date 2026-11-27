import { OutboxRelay } from '@/modules/invoice/application/outbox-relay';
import { BillingCoreModule } from '@/modules/billing/billing-core.module';
import { BillingScheduler } from '@/modules/billing/jobs/billing.scheduler';
import { NfseWorkflowService } from '@/modules/invoice/application/nfse-workflow.service';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { NfseEmissionProcessor } from '@/modules/invoice/jobs/nfse-emission.processor';
import { NfseReconciliationProcessor } from '@/modules/invoice/jobs/nfse-reconciliation.processor';
import { NfseCancellationProcessor } from '@/modules/invoice/jobs/nfse-cancellation.processor';
import { NfseCancellationService } from '@/modules/invoice/application/nfse-cancellation.service';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '@/infra/config/config.module';
import { AppDatabaseModule } from '@/infra/database/database.module';
import { AppLoggingModule } from '@/infra/logging/logging.module';
import { TypeOrmPersistenceModule } from '@/infra/persistence/typeorm/typeorm-persistence.module';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { HealthModule } from '@/modules/health/health.module';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';
import { SentryModule } from '@/infra/observability/sentry.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { IntegrationsModule } from '@/modules/integrations/integrations.module';
import { WooviConnectorModule } from '@/modules/integrations/connectors/woovi/woovi.module';
import { AbacatePayConnectorModule } from '@/modules/integrations/connectors/abacatepay/abacatepay.module';
import { PushinPayConnectorModule } from '@/modules/integrations/connectors/pushinpay/pushinpay.module';
import { StripeConnectorModule } from '@/modules/integrations/connectors/stripe/stripe.module';
import { KiwifyConnectorModule } from '@/modules/integrations/connectors/kiwify/kiwify.module';
import { HotmartConnectorModule } from '@/modules/integrations/connectors/hotmart/hotmart.module';
import { EventProcessorScheduler } from '@/modules/integrations/jobs/event-processor.scheduler';
import { FiscalEngineModule } from '@/modules/invoice/application/fiscal/fiscal-engine.module';
import { CompanyModule } from '@/modules/company/company.module';
import { EmailExternalModule } from '@/infra/external/email/email-external.module';
import { EmailModule } from '@/modules/email/email.module';
import { EmailProcessor } from '@/infra/queues/email.processor';
import { NfseEmailProcessor } from '@/modules/invoice/jobs/nfse-email.processor';
import { NfseDocPrepProcessor } from '@/modules/invoice/jobs/nfse-doc-prep.processor';
import { FiscalReconciliationProcessor } from '@/modules/invoice/jobs/fiscal-reconciliation.processor';
import { DocsRecoveryScheduler } from '@/modules/invoice/jobs/docs-recovery.scheduler';
import { ManualReviewSweepScheduler } from '@/modules/invoice/jobs/manual-review-sweep.scheduler';
import { AccountantPackageScheduler } from '@/modules/invoice/jobs/accountant-package.scheduler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LifecycleEmailsModule } from '@/modules/lifecycle-emails/lifecycle-emails.module';
import {
  LifecycleMonthlySummaryScheduler,
  LifecyclePaymentReminderScheduler,
} from '@/modules/lifecycle-emails/jobs/lifecycle-emails.scheduler';
import { FISCAL_RECONCILIATION_REPOSITORY } from '@/modules/invoice/domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import { TypeOrmFiscalReconciliationRepository } from '@/modules/invoice/infra/fiscal/typeorm-fiscal-reconciliation.repository';
import { InvoiceFiscalReconciliationOrmEntity } from '@/modules/invoice/infra/fiscal/invoice-fiscal-reconciliation.orm-entity';
import {
  FiscalReconciliationService,
  InvoiceWebhookPublisher,
} from '@/modules/invoice/application/fiscal/fiscal-reconciliation.service';
import { ImportModule } from '@/modules/import/import.module';
import { ImportCleanupCron } from '@/modules/import/jobs/import-cleanup.cron';
import { ImportEmitProcessor } from '@/modules/import/jobs/import-emit.processor';
import { ImportReadProcessor } from '@/modules/import/jobs/import-read.processor';
import { PortalReachabilityModule } from '@/modules/portal-reachability/portal-reachability.module';
import { PortalSyncModule } from '@/modules/portal-sync/portal-sync.module';
import { NfceModule } from '@/modules/nfce/nfce.module';
import { NfeModule } from '@/modules/nfe/nfe.module';
import { AccountAuditModule } from '@/modules/account-audit/account-audit.module';
import { AccountAuditRetentionScheduler } from '@/modules/account-audit/jobs/account-audit-retention.scheduler';
import { PortalSyncScheduler } from '@/modules/portal-sync/jobs/portal-sync.scheduler';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { DpsBuilder } from '@/modules/invoice/domain/fiscal/dps/dps-builder';

@Module({
  imports: [
    BillingCoreModule,
    SentryModule.forRoot('worker'),
    AppConfigModule,
    AppLoggingModule,
    AppDatabaseModule,
    TypeOrmPersistenceModule,
    AccountAuditModule.forRoot('worker'),
    AppRedisModule,
    HealthModule,
    ScheduleModule.forRoot(),
    WebhooksConfigModule,
    InvoiceModule,
    IntegrationsModule,
    WooviConnectorModule,
    AbacatePayConnectorModule,
    PushinPayConnectorModule,
    StripeConnectorModule,
    KiwifyConnectorModule,
    HotmartConnectorModule,
    FiscalEngineModule,
    CompanyModule,
    CertificateModule,
    TypeOrmModule.forFeature([InvoiceFiscalReconciliationOrmEntity]),
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'nfse-doc-prep' }),
    BullModule.registerQueue({ name: 'nfse-email' }),
    BullModule.registerQueue({ name: 'nfse-fiscal-reconcile' }),
    EmailExternalModule,
    EmailModule,
    ImportModule,
    PortalSyncModule,
    // Registers the nfe.* handlers on the outbox registry the relay above reads.
    NfeModule,
    NfceModule,
    PortalReachabilityModule,
    LifecycleEmailsModule,
  ],
  providers: [
    EventProcessorScheduler,
    OutboxRelay,
    ...(IS_SELF_HOSTED ? [] : [BillingScheduler]),
    NfseWorkflowService,
    EmailProcessor,
    NfseEmissionProcessor,
    NfseReconciliationProcessor,
    NfseCancellationService,
    NfseCancellationProcessor,
    NfseDocPrepProcessor,
    FiscalReconciliationProcessor,
    {
      provide: FISCAL_RECONCILIATION_REPOSITORY,
      useClass: TypeOrmFiscalReconciliationRepository,
    },
    InvoiceWebhookPublisher,
    FiscalReconciliationService,
    DpsBuilder,
    NfseEmailProcessor,
    DocsRecoveryScheduler,
    ManualReviewSweepScheduler,
    AccountantPackageScheduler,
    ImportReadProcessor,
    ImportEmitProcessor,
    ImportCleanupCron,
    PortalSyncScheduler,
    AccountAuditRetentionScheduler,
    ...(IS_SELF_HOSTED
      ? []
      : [LifecycleMonthlySummaryScheduler, LifecyclePaymentReminderScheduler]),
  ],
})
export class WorkerAppModule {}
