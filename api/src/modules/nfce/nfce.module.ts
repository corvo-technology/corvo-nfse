import { Module } from '@nestjs/common';
import { CompanyModule } from '@/modules/company/company.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { NfeModule } from '@/modules/nfe/nfe.module';
import { NfcePreparation } from './application/nfce-preparation.service';
import { NfceValidateService } from './application/nfce-validate.service';
import { NfceInvoiceRoutes } from './http/nfce-invoice.routes';

/**
 * NFC-e (model 65). It lives in the NF-e tables with `model = 65` and reuses the NF-e machinery
 * (`NfeModule`); what only the NFC-e has (its DTO, validators, QR Code, routes) is here. No
 * controllers: `/v1/invoices` serves it through `NfceInvoiceRoutes`, registered in the router.
 */
@Module({
  imports: [CompanyModule, InvoiceModule, NfeModule],
  providers: [NfcePreparation, NfceValidateService, NfceInvoiceRoutes],
})
export class NfceModule {}
