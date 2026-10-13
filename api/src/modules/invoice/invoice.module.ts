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
    BullModule.registerQueue(
      { name: 'nfse-emission' },
      { name: 'nfse-reconciliation' },
      { name: 'nfse-doc-prep' },
      { name: 'nfse-email' },
    ),
    TypeOrmModule.forFeature([
      InvoiceOrmEntity,
      InvoiceEventOrmEntity,
      DpsSequenceOrmEntity,
    ]),
    PlansModule,
    CompanyModule,
    CertificateModule,
    WebhooksConfigModule,
    StorageModule.forRoot(),
    NfseExternalModule,
    EmailModule,
  ],
  controllers: [InvoiceController],
  providers: [
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
    InvoiceService,
    InvoiceLifecycleService,
    InvoiceDomainService,
  ],
  exports: [
    InvoiceService,
    InvoiceLifecycleService,
    INVOICE_REPOSITORY,
    INVOICE_EVENT_REPOSITORY,
    DPS_SEQUENCE_REPOSITORY,
  ],
})
export class InvoiceModule {}
