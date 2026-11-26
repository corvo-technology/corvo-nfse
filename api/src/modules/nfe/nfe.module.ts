import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TableAuthorityEndpointResolver } from '@/infra/external/nfe/sefaz/endpoints';
import { FakeNfeGateway } from '@/infra/external/nfe/sefaz/fake-nfe.gateway';
import { NfeGateway } from '@/infra/external/nfe/sefaz/nfe-gateway';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { SefazSoapClient } from '@/infra/external/nfe/sefaz/soap-client';
import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { CompanyModule } from '@/modules/company/company.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { DocumentCreditLedger } from '@/modules/fiscal-core/application/document-credit-ledger';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { FiscalWebhookPublisher } from '@/modules/fiscal-core/application/fiscal-webhook.publisher';
import { OutboxService } from '@/modules/invoice/application/outbox.service';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';
import { NfeConsultService } from './application/nfe-consult.service';
import { NfeEmitHandler } from './application/nfe-emit.handler';
import { NfeIntakeService } from './application/nfe-intake.service';
import { NfeOutcomeService } from './application/nfe-outcome.service';
import { NfePreparation } from './application/nfe-preparation.service';
import {
  NfePrepareDocumentsPlaceholder,
  NfeReconcileHandler,
} from './application/nfe-reconcile.handler';
import { NfeResubmitService } from './application/nfe-resubmit.service';
import { NfeSefazAccess } from './application/nfe-sefaz-access';
import { NfeTransitionService } from './application/nfe-transition.service';
import { NfeValidateService } from './application/nfe-validate.service';
import { INfeDocumentRepository } from './domain/nfe-document.repository';
import { INfeNumberPreview } from './domain/nfe-number-preview';
import { NfeController } from './http/nfe.controller';
import { NfeValidateController } from './http/nfe-validate.controller';
import { NfeDocumentHistoryOrmEntity } from './infra/nfe-document-history.orm-entity';
import { NfeDocumentItemOrmEntity } from './infra/nfe-document-item.orm-entity';
import { NfeDocumentOrmEntity } from './infra/nfe-document.orm-entity';
import { NfeNumberSequenceOrmEntity } from './infra/nfe-number-sequence.orm-entity';
import { TypeOrmNfeDocumentRepository } from './infra/typeorm-nfe-document.repository';
import { TypeormNfeNumbering } from './infra/typeorm-nfe-numbering';
import { NFE_SCHEMA_VALIDATOR } from './nfe.tokens';

/**
 * NF-e (model 55): documents, numbering, the dry-run, emission and consultation by key. Events,
 * the DANFE and the e-mail arrive in the next PRs.
 *
 * `FiscalDocumentRegistry` gets the simulator when `NFE_TEST_PROVIDER` is `fake` and the real SEFAZ
 * gateway otherwise (homologation only: `NFE_PRODUCTION_ENABLED` keeps `tpAmb 1` closed).
 */
@Module({
  imports: [
    CompanyModule,
    CertificateModule,
    InvoiceModule,
    WebhooksConfigModule,
    BillingUsageModule,
    CreditsModule,
    TypeOrmModule.forFeature([
      NfeDocumentOrmEntity,
      NfeDocumentItemOrmEntity,
      NfeDocumentHistoryOrmEntity,
      NfeNumberSequenceOrmEntity,
    ]),
  ],
  controllers: [NfeValidateController, NfeController],
  providers: [
    NfePreparation,
    NfeValidateService,
    NfeIntakeService,
    NfeTransitionService,
    NfeOutcomeService,
    NfeConsultService,
    NfeResubmitService,
    NfeSefazAccess,
    NfeEmitHandler,
    NfeReconcileHandler,
    NfePrepareDocumentsPlaceholder,
    DocumentCreditLedger,
    FiscalWebhookPublisher,
    OutboxService,
    TypeormNfeNumbering,
    { provide: INfeNumberPreview, useExisting: TypeormNfeNumbering },
    { provide: INfeDocumentRepository, useClass: TypeOrmNfeDocumentRepository },
    { provide: NFE_SCHEMA_VALIDATOR, useClass: XmllintSchemaValidator },
  ],
  exports: [INfeDocumentRepository, TypeormNfeNumbering],
})
export class NfeModule implements OnModuleInit {
  constructor(
    private readonly registry: FiscalDocumentRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.registry.has('nfe')) return;
    if (this.config.get<string>('NFE_TEST_PROVIDER') === 'fake') {
      this.registry.register(new FakeNfeGateway());
      return;
    }
    const timeoutMs = this.config.get<number>('NFE_SEFAZ_TIMEOUT_MS') ?? 30_000;
    this.registry.register(
      new NfeGateway(
        new SefazSoapClient(),
        new TableAuthorityEndpointResolver(),
        new XmllintSchemaValidator(),
        timeoutMs,
      ).asFiscalGateway(),
    );
  }
}
