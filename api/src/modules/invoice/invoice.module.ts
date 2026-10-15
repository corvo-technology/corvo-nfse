import { CreditsModule } from '@/modules/credits/credits.module';
import { ConfigService } from '@nestjs/config';
import type { OutboxConfig } from '@/infra/config/configuration.types';
import { SCHEDULE_MAX_DAYS } from './domain/invoice-domain.service';
import { InvoiceEmitHandler } from './application/invoice-emit.handler';
import { CalculateTaxesHandler } from './application/fiscal/calculate-taxes.handler';
import { OutboxService } from './application/outbox.service';
import { OutboxHandlerRegistry } from './application/outbox-handler.registry';
import { OUTBOX_REPOSITORY } from './domain/outbox.repository';
import { TypeOrmOutboxRepository } from './infra/typeorm-outbox.repository';
import { OutboxMessageOrmEntity } from './infra/outbox-message.orm-entity';
import { InvoiceFiscalSnapshotOrmEntity } from './infra/invoice-fiscal-snapshot.orm-entity';
import { TypeOrmInvoiceFiscalSnapshotRepository } from './infra/typeorm-invoice-fiscal-snapshot.repository';
import { InvoiceFiscalReconciliationOrmEntity } from './infra/fiscal/invoice-fiscal-reconciliation.orm-entity';
import { TypeOrmFiscalReconciliationRepository } from './infra/fiscal/typeorm-fiscal-reconciliation.repository';
import { FISCAL_RECONCILIATION_REPOSITORY } from './domain/fiscal/reconciliation/fiscal-reconciliation.repository';
import {
  FiscalReconciliationService,
  InvoiceWebhookPublisher,
} from './application/fiscal/fiscal-reconciliation.service';
import { DpsBuilder } from './domain/fiscal/dps/dps-builder';
import { FiscalSnapshotService } from './application/fiscal/fiscal-snapshot.service';
import { FiscalEngineModule } from './application/fiscal/fiscal-engine.module';
import { FISCAL_SNAPSHOT_REPOSITORY } from './domain/fiscal/fiscal-snapshot.repository';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { PlansModule } from '@/modules/plans/plans.module';
import { InvoiceLifecycleService } from './application/invoice-lifecycle.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceDomainService } from './domain/invoice-domain.service';
import { InvoiceOrmEntity } from './infra/invoice.orm-entity';
import { InvoiceEventOrmEntity } from './infra/invoice-event.orm-entity';
import { DpsSequenceOrmEntity } from './infra/dps-sequence.orm-entity';
import { TypeOrmInvoiceRepository } from './infra/typeorm-invoice.repository';
import { TypeOrmInvoiceEventRepository } from './infra/typeorm-invoice-event.repository';
import { TypeOrmDpsSequenceRepository } from './infra/typeorm-dps-sequence.repository';
import {
  INVOICE_REPOSITORY,
  INVOICE_EVENT_REPOSITORY,
} from './domain/invoice.repository';
import { DPS_SEQUENCE_REPOSITORY } from './domain/dps-sequence';
import { InvoiceService } from './application/invoice.service';
import { InvoiceController } from './http/invoice.controller';
import { CompanyModule } from '@/modules/company/company.module';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';
import { StorageModule } from '@/infra/storage/storage.module';
import { NfseExternalModule } from '@/infra/external/nfse/nfse-external.module';
import { EmailModule } from '@/modules/email/email.module';

@Module({
  imports: [
    BillingUsageModule,
    CreditsModule,
    BullModule.registerQueue(
      { name: 'nfse-emission' },
      { name: 'nfse-reconciliation' },
      { name: 'nfse-doc-prep' },
      { name: 'nfse-email' },
      {
        name: 'nfse-fiscal-reconcile',
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'fixed', delay: 10000 },
          removeOnComplete: false,
          removeOnFail: 1000,
        },
      },
    ),
    TypeOrmModule.forFeature([
      OutboxMessageOrmEntity,
      InvoiceOrmEntity,
      InvoiceEventOrmEntity,
      DpsSequenceOrmEntity,
      InvoiceFiscalSnapshotOrmEntity,
      InvoiceFiscalReconciliationOrmEntity,
    ]),
    PlansModule,
    CompanyModule,
    CertificateModule,
    WebhooksConfigModule,
    StorageModule.forRoot(),
    NfseExternalModule,
    EmailModule,
    FiscalEngineModule,
  ],
  controllers: [InvoiceController],
  providers: [
    InvoiceEmitHandler,
    CalculateTaxesHandler,
    {
      provide: SCHEDULE_MAX_DAYS,
      useFactory: (config: ConfigService) =>
        config.get<OutboxConfig>('outbox')?.scheduleMaxDays ?? 15,
      inject: [ConfigService],
    },
    OutboxService,
    OutboxHandlerRegistry,
    { provide: OUTBOX_REPOSITORY, useClass: TypeOrmOutboxRepository },
    {
      provide: INVOICE_REPOSITORY,
      useClass: TypeOrmInvoiceRepository,
    },
    {
      provide: INVOICE_EVENT_REPOSITORY,
      useClass: TypeOrmInvoiceEventRepository,
    },
    {
      provide: DPS_SEQUENCE_REPOSITORY,
      useClass: TypeOrmDpsSequenceRepository,
    },
    {
      provide: FISCAL_SNAPSHOT_REPOSITORY,
      useClass: TypeOrmInvoiceFiscalSnapshotRepository,
    },
    {
      provide: FISCAL_RECONCILIATION_REPOSITORY,
      useClass: TypeOrmFiscalReconciliationRepository,
    },
    InvoiceWebhookPublisher,
    FiscalReconciliationService,
    FiscalSnapshotService,
    DpsBuilder,
    InvoiceService,
    InvoiceLifecycleService,
    InvoiceDomainService,
  ],
  exports: [
    OutboxHandlerRegistry,
    OUTBOX_REPOSITORY,
    InvoiceService,
    InvoiceLifecycleService,
    INVOICE_REPOSITORY,
    INVOICE_EVENT_REPOSITORY,
    DPS_SEQUENCE_REPOSITORY,
    FISCAL_SNAPSHOT_REPOSITORY,
    FISCAL_RECONCILIATION_REPOSITORY,
    FiscalReconciliationService,
    FiscalSnapshotService,
    FiscalEngineModule,
  ],
})
export class InvoiceModule {}
