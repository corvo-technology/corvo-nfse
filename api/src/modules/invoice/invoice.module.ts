import { InvoiceCalculationService } from './application/fiscal/invoice-calculation.service';
import { CreditsModule } from '@/modules/credits/credits.module';
import { ConfigService } from '@nestjs/config';
import type { OutboxConfig } from '@/infra/config/configuration.types';
import { SCHEDULE_MAX_DAYS } from './domain/invoice-domain.service';
import { InvoiceEmitHandler } from './application/invoice-emit.handler';
import { InvoiceCancelHandler } from './application/invoice-cancel.handler';
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
// Main's fiscal-discrepancy publisher shares its class name with the invoice
// lifecycle publisher below; they are distinct providers (DI keys by class).
import {
  FiscalReconciliationService,
  InvoiceWebhookPublisher as FiscalDiscrepancyWebhookPublisher,
} from './application/fiscal/fiscal-reconciliation.service';
import { DpsBuilder } from './domain/fiscal/dps/dps-builder';
import { FiscalSnapshotService } from './application/fiscal/fiscal-snapshot.service';
import { FiscalEngineModule } from './application/fiscal/fiscal-engine.module';
import { FISCAL_SNAPSHOT_REPOSITORY } from './domain/fiscal/fiscal-snapshot.repository';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { PlansModule } from '@/modules/plans/plans.module';
import { InvoiceWebhookPublisher } from './application/invoice-webhook.publisher';
import { InvoiceLifecycleService } from './application/invoice-lifecycle.service';
import { InvoicePdfRefresher } from './application/invoice-pdf-refresher';
import { Module, forwardRef } from '@nestjs/common';
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
import { DpsSequenceController } from './http/dps-sequence.controller';
import { InvoiceSubstitutionService } from './application/invoice-substitution.service';
import { InvoiceIntakeService } from './application/invoice-intake.service';
import { CustomerRecorder } from './application/customer-recorder';
import { CustomerDirectory } from './domain/customer-directory';
import { CustomerOrmEntity } from './infra/customer.orm-entity';
import { TypeOrmCustomerDirectory } from './infra/typeorm-customer-directory';
import { CustomerController } from './http/customer.controller';
import { InvoiceService } from './application/invoice.service';
import { IntegrationInvoiceIssuer } from './application/integration-invoice-issuer';
import { InvoiceIssuancePort } from '@/modules/integrations/domain/invoice-issuance.port';
import { IntegrationInvoiceCanceller } from './application/integration-invoice-canceller';
import { InvoiceCancellationPort } from '@/modules/integrations/domain/invoice-cancellation.port';
import { InvoiceBatchService } from './application/invoice-batch.service';
import { InvoiceController } from './http/invoice.controller';
import { InvoiceOverviewController } from './http/invoice-overview.controller';
import { InvoiceOverviewService } from './application/invoice-overview.service';
import { INVOICE_OVERVIEW_REPOSITORY } from './domain/invoice-overview.repository';
import { TypeOrmInvoiceOverviewRepository } from './infra/typeorm-invoice-overview.repository';
import { CompanyModule } from '@/modules/company/company.module';
import { InvoiceScheduleModule } from '@/modules/invoice-schedule/invoice-schedule.module';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';
import { StorageModule } from '@/infra/storage/storage.module';
import { NfseExternalModule } from '@/infra/external/nfse/nfse-external.module';
import { EmailModule } from '@/modules/email/email.module';
import { InvoiceReviewController } from './http/invoice-review.controller';
import { InvoiceReviewService } from './application/invoice-review.service';
import { FiscalPortalBreaker } from './application/fiscal-portal-breaker';
import { InvoicePackageService } from './application/package/invoice-package.service';
import { PackageLinkService } from './application/package/package-link.service';
import { AccountantPackageService } from './application/package/accountant-package.service';
import {
  InvoicePackageController,
  InvoicePackageLinkController,
} from './http/invoice-package.controller';
import { IInvoicePackageRepository } from './domain/invoice-package.repository';
import { IAccountantPackageRepository } from './domain/accountant-package.repository';
import { TypeOrmInvoicePackageRepository } from './infra/typeorm-invoice-package.repository';
import { TypeOrmAccountantPackageRepository } from './infra/typeorm-accountant-package.repository';
import { AccountantPackageController } from './http/accountant-package.controller';

/** Month package for the accountant: ZIP download, temporary links and the monthly e-mail. */
const ACCOUNTANT_PACKAGE = {
  controllers: [
    InvoicePackageController,
    InvoicePackageLinkController,
    AccountantPackageController,
  ],
  providers: [
    InvoicePackageService,
    PackageLinkService,
    AccountantPackageService,
    {
      provide: IInvoicePackageRepository,
      useClass: TypeOrmInvoicePackageRepository,
    },
    {
      provide: IAccountantPackageRepository,
      useClass: TypeOrmAccountantPackageRepository,
    },
  ],
};

@Module({
  imports: [
    forwardRef(() => InvoiceScheduleModule),
    BillingUsageModule,
    CreditsModule,
    BullModule.registerQueue(
      { name: 'nfse-emission' },
      { name: 'nfse-reconciliation' },
      { name: 'nfse-cancellation' },
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
      CustomerOrmEntity,
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
  // Static overview route must be registered before InvoiceController's :id.
  controllers: [
    InvoiceOverviewController,
    InvoiceReviewController,
    InvoiceController,
    DpsSequenceController,
    CustomerController,
    ...ACCOUNTANT_PACKAGE.controllers,
  ],
  providers: [
    ...ACCOUNTANT_PACKAGE.providers,
    InvoiceOverviewService,
    InvoiceReviewService,
    FiscalPortalBreaker,
    {
      provide: INVOICE_OVERVIEW_REPOSITORY,
      useClass: TypeOrmInvoiceOverviewRepository,
    },
    InvoiceEmitHandler,
    InvoiceCancelHandler,
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
    FiscalDiscrepancyWebhookPublisher,
    FiscalReconciliationService,
    FiscalSnapshotService,
    DpsBuilder,
    InvoiceService,
    { provide: InvoiceIssuancePort, useClass: IntegrationInvoiceIssuer },
    {
      provide: InvoiceCancellationPort,
      useClass: IntegrationInvoiceCanceller,
    },
    InvoiceBatchService,
    InvoiceIntakeService,
    InvoiceSubstitutionService,
    { provide: CustomerDirectory, useClass: TypeOrmCustomerDirectory },
    CustomerRecorder,
    InvoiceCalculationService,
    InvoiceLifecycleService,
    InvoiceWebhookPublisher,
    InvoiceDomainService,
  ],
  exports: [
    ...ACCOUNTANT_PACKAGE.providers,
    FiscalPortalBreaker,
    OutboxHandlerRegistry,
    OUTBOX_REPOSITORY,
    InvoiceService,
    InvoiceIssuancePort,
    InvoiceCancellationPort,
    InvoiceBatchService,
    InvoiceCalculationService,
    InvoiceSubstitutionService,
    CustomerDirectory,
    InvoiceLifecycleService,
    InvoicePdfRefresher,
    InvoiceWebhookPublisher,
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
