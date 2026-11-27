import { Global, Module } from '@nestjs/common';
import { FiscalDocumentRegistry } from './application/fiscal-document.registry';
import { InvoiceTypeRouter } from './application/invoice-type.router';
import { NfeEmissionPreconditions } from './application/nfe-emission-preconditions';
import { TypeormInvoiceSummaries } from './infra/typeorm-invoice-summaries';

@Global()
@Module({
  providers: [
    FiscalDocumentRegistry,
    InvoiceTypeRouter,
    TypeormInvoiceSummaries,
    NfeEmissionPreconditions,
  ],
  exports: [
    FiscalDocumentRegistry,
    InvoiceTypeRouter,
    NfeEmissionPreconditions,
  ],
})
export class FiscalCoreModule {}
