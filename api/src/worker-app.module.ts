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
import { CompanyModule } from '@/modules/company/company.module';
import { EmailExternalModule } from '@/infra/external/email/email-external.module';
import { EmailModule } from '@/modules/email/email.module';
import { EmailProcessor } from '@/infra/queues/email.processor';
import { NfseEmailProcessor } from '@/modules/invoice/jobs/nfse-email.processor';
import { NfseDocPrepProcessor } from '@/modules/invoice/jobs/nfse-doc-prep.processor';
import { DocsRecoveryScheduler } from '@/modules/invoice/jobs/docs-recovery.scheduler';

@Module({
  imports: [
    BillingCoreModule,
    SentryModule.forRoot('worker'),
    AppConfigModule,
    AppLoggingModule,
    AppDatabaseModule,
    TypeOrmPersistenceModule,
    AppRedisModule,
    HealthModule,
    ScheduleModule.forRoot(),
    WebhooksConfigModule,
    InvoiceModule,
    CompanyModule,
    CertificateModule,
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'nfse-doc-prep' }),
    BullModule.registerQueue({ name: 'nfse-email' }),
    EmailExternalModule,
    EmailModule,
  ],
  providers: [
    OutboxRelay,
    BillingScheduler,
    NfseWorkflowService,
    EmailProcessor,
    NfseEmissionProcessor,
    NfseReconciliationProcessor,
    NfseCancellationService,
    NfseCancellationProcessor,
    NfseDocPrepProcessor,
    NfseEmailProcessor,
    DocsRecoveryScheduler,
  ],
})
export class WorkerAppModule {}
