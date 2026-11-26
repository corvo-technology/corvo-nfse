import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TableAuthorityEndpointResolver } from '@/infra/external/nfe/sefaz/endpoints';
import { FakeNfeGateway } from '@/infra/external/nfe/sefaz/fake-nfe.gateway';
import { NfeGateway } from '@/infra/external/nfe/sefaz/nfe-gateway';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { SefazSoapClient } from '@/infra/external/nfe/sefaz/soap-client';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
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
export class NfceModule implements OnModuleInit {
  constructor(
    private readonly registry: FiscalDocumentRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * The gateway of the NFC-e (model 65): the simulator with `NFE_TEST_PROVIDER=fake`, the SEFAZ
   * (`NfeGateway` with `type: 'nfce'`) otherwise. Neither has a correction letter.
   */
  onModuleInit(): void {
    if (this.registry.has('nfce')) return;
    if (this.config.get<string>('NFE_TEST_PROVIDER') === 'fake') {
      this.registry.register(new FakeNfeGateway(() => new Date(), 'nfce'));
      return;
    }
    const timeoutMs = this.config.get<number>('NFE_SEFAZ_TIMEOUT_MS') ?? 30_000;
    this.registry.register(
      new NfeGateway(
        new SefazSoapClient(),
        new TableAuthorityEndpointResolver(),
        new XmllintSchemaValidator(),
        timeoutMs,
        { type: 'nfce', model: 65 },
      ).asFiscalGateway(),
    );
  }
}
