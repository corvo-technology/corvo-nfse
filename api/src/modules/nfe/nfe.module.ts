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
import { NfeCancelHandler } from './application/nfe-cancel.handler';
import { NfeCancelService } from './application/nfe-cancel.service';
import { NfeConsultService } from './application/nfe-consult.service';
import { NfeCorrectHandler } from './application/nfe-correct.handler';
import { NfeCorrectService } from './application/nfe-correct.service';
import { NfeEventContext } from './application/nfe-event-context';
import { NfeEventOutcomeService } from './application/nfe-event-outcome.service';
import { NfeEventReconcile } from './application/nfe-event-reconcile';
import { NfeEventSender } from './application/nfe-event-sender';
import { NfeInutilizeHandler } from './application/nfe-inutilize.handler';
import { NfeInutilizeService } from './application/nfe-inutilize.service';
import { NfeTimelineService } from './application/nfe-timeline.service';
import { NfeEmitHandler } from './application/nfe-emit.handler';
import { NfeIntakeService } from './application/nfe-intake.service';
import { NfeOutcomeService } from './application/nfe-outcome.service';
import { NfePreparation } from './application/nfe-preparation.service';
import { NfeFilesService } from './application/nfe-files.service';
import { NfePackageContributor } from './application/nfe-package.contributor';
import { NfeEmailService } from './application/nfe-email.service';
import { NfePrepareDocumentsHandler } from './application/nfe-prepare-documents.handler';
import { NfeReconcileHandler } from './application/nfe-reconcile.handler';
import { NfeSendEmailHandler } from './application/nfe-send-email.handler';
import { NfeResubmitService } from './application/nfe-resubmit.service';
import { NfeSefazAccess } from './application/nfe-sefaz-access';
import { NfeTransitionService } from './application/nfe-transition.service';
import { NfeValidateService } from './application/nfe-validate.service';
import { INfeDocumentRepository } from './domain/nfe-document.repository';
import { INfeNumberPreview } from './domain/nfe-number-preview';
import { NfeInvoiceRoutes } from './http/nfe-invoice.routes';
import { NfeNumberGapsScheduler } from './jobs/nfe-number-gaps.scheduler';
import { NfeDocumentEventOrmEntity } from './infra/nfe-document-event.orm-entity';
import { NfeDocumentHistoryOrmEntity } from './infra/nfe-document-history.orm-entity';
import { NfeDocumentItemOrmEntity } from './infra/nfe-document-item.orm-entity';
import { NfeDocumentOrmEntity } from './infra/nfe-document.orm-entity';
import { NfeInutilizationOrmEntity } from './infra/nfe-inutilization.orm-entity';
import { NfeNumberSequenceOrmEntity } from './infra/nfe-number-sequence.orm-entity';
import { TypeOrmNfeDocumentRepository } from './infra/typeorm-nfe-document.repository';
import { TypeormNfePackageQuery } from './infra/typeorm-nfe-package.query';
import { TypeormNfeEvents } from './infra/typeorm-nfe-events';
import { TypeormNfeInutilizations } from './infra/typeorm-nfe-inutilizations';
import { NfeNumberGapsQuery } from './infra/typeorm-nfe-number-gaps.query';
import { TypeormNfeNumbering } from './infra/typeorm-nfe-numbering';
import {
  NFCE_DANFCE_RENDERER,
  NFE_DANFE_RENDERER,
  NFE_SCHEMA_VALIDATOR,
} from './nfe.tokens';
import { DanfceRenderer } from '@/modules/nfce/infra/danfce/danfce-renderer';
import { DanfeRenderer } from './infra/danfe/danfe-renderer';

/**
 * NF-e (model 55): documents, numbering, the dry-run, emission, consultation by key, the events
 * (cancellation, correction letter, inutilization), the numbering gaps, the stored documents
 * (`nfeProc`, DANFE, event XML) and the e-mail to the customer.
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
      NfeDocumentEventOrmEntity,
      NfeInutilizationOrmEntity,
    ]),
  ],
  // No controllers: `/v1/invoices` serves NF-e through `NfeInvoiceRoutes`, registered in the router.
  providers: [
    NfeInvoiceRoutes,
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
    NfeEventContext,
    NfeEventOutcomeService,
    NfeEventSender,
    NfeEventReconcile,
    NfeCancelService,
    NfeCancelHandler,
    NfeCorrectService,
    NfeCorrectHandler,
    NfeInutilizeService,
    NfeInutilizeHandler,
    NfeTimelineService,
    NfeNumberGapsScheduler,
    NfeNumberGapsQuery,
    TypeormNfeEvents,
    TypeormNfeInutilizations,
    NfePrepareDocumentsHandler,
    NfeEmailService,
    NfeFilesService,
    NfePackageContributor,
    TypeormNfePackageQuery,
    NfeSendEmailHandler,
    DocumentCreditLedger,
    FiscalWebhookPublisher,
    OutboxService,
    TypeormNfeNumbering,
    { provide: INfeNumberPreview, useExisting: TypeormNfeNumbering },
    { provide: INfeDocumentRepository, useClass: TypeOrmNfeDocumentRepository },
    { provide: NFE_SCHEMA_VALIDATOR, useClass: XmllintSchemaValidator },
    { provide: NFE_DANFE_RENDERER, useClass: DanfeRenderer },
    { provide: NFCE_DANFCE_RENDERER, useClass: DanfceRenderer },
  ],
  exports: [
    INfeDocumentRepository,
    INfeNumberPreview,
    TypeormNfeNumbering,
    NFE_SCHEMA_VALIDATOR,
    // What the NFC-e routes (`NfceModule`) reuse: the NFC-e runs on the same machinery.
    NfeIntakeService,
    NfeResubmitService,
    NfeConsultService,
    NfeCancelService,
    NfeTimelineService,
    NfeFilesService,
    NfeInutilizeService,
    TypeormNfeInutilizations,
    NfeNumberGapsQuery,
  ],
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
