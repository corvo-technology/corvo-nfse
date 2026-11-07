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
import { TypeOrmModule } from '@nestjs/typeorm';
import { FISCAL_RECONCILIATION_REPOSITORY } from '@/modules/invoice/domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import { TypeOrmFiscalReconciliationRepository } from '@/modules/invoice/infra/fiscal/typeorm-fiscal-reconciliation.repository';
import { InvoiceFiscalReconciliationOrmEntity } from '@/modules/invoice/infra/fiscal/invoice-fiscal-reconciliation.orm-entity';
import {
  FiscalReconciliationService,
  InvoiceWebhookPublisher,
} from '@/modules/invoice/application/fiscal/fiscal-reconciliation.service';
import { ImportModule } from '@/modules/import/import.module';
import { ImportReadProcessor } from '@/modules/import/jobs/import-read.processor';
import { DpsBuilder } from '@/modules/invoice/domain/fiscal/dps/dps-builder';

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
    IntegrationsModule,
    WooviConnectorModule,
    AbacatePayConnectorModule,
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
  ],
  providers: [
    EventProcessorScheduler,
    OutboxRelay,
    BillingScheduler,
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
    ImportReadProcessor,
  ],
})
export class WorkerAppModule {}
