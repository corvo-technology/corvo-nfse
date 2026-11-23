import { Module } from '@nestjs/common';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { IPortalSyncRepository } from './domain/portal-sync.repository';
import { TypeOrmPortalSyncRepository } from './infra/typeorm-portal-sync.repository';
import { PortalEventProcessor } from './application/portal-event.processor';
import { PortalSyncService } from './application/portal-sync.service';

/** Reads the national portal for what happened to issued invoices. The scheduler runs in the worker only. */
@Module({
  imports: [InvoiceModule, CertificateModule],
  providers: [
    { provide: IPortalSyncRepository, useClass: TypeOrmPortalSyncRepository },
    PortalEventProcessor,
    PortalSyncService,
  ],
  exports: [PortalSyncService, IPortalSyncRepository],
})
export class PortalSyncModule {}
