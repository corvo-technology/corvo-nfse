import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '@/modules/invoice/domain/invoice.repository';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context';
import { InvoiceService } from '../invoice/application/invoice.service';
import { InvoiceBatchService } from '../invoice/application/invoice-batch.service';
import { InvoiceCalculationService } from '../invoice/application/fiscal/invoice-calculation.service';
import { QuotaService } from '@/modules/plans/application/quota.service';
import { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import { ImportEmitService } from '@/modules/import/application/import-emit.service';
import { ImportIntakeService } from '@/modules/import/application/import-intake.service';
import { ImportReviewService } from '@/modules/import/application/import-review.service';
import { ScheduleService } from '@/modules/invoice-schedule/application/schedule.service';
import {
  SCHEDULE_CANCEL_TOOL,
  SCHEDULE_GET_TOOL,
  SCHEDULE_LIST_TOOL,
  SCHEDULE_PAUSE_TOOL,
  SCHEDULE_RESUME_TOOL,
  SCHEDULE_RUNS_TOOL,
  SCHEDULE_UPDATE_TOOL,
  createScheduleCancelHandler,
  createScheduleGetHandler,
  createScheduleListHandler,
  createSchedulePauseHandler,
  createScheduleResumeHandler,
  createScheduleRunsHandler,
  createScheduleUpdateHandler,
} from './tools/schedule.tools';
import {
  IMPORT_CREATE_TOOL,
  IMPORT_DISCARD_TOOL,
  IMPORT_EMIT_TOOL,
  IMPORT_FIX_ROW_TOOL,
  IMPORT_GET_TOOL,
  IMPORT_LIST_TOOL,
  IMPORT_ROWS_TOOL,
  createImportCreateHandler,
  createImportDiscardHandler,
  createImportEmitHandler,
  createImportFixRowHandler,
  createImportGetHandler,
  createImportListHandler,
  createImportRowsHandler,
} from './tools/import.tools';
import { McpServer } from './mcp.server';
import {
  NFSE_ISSUE_TOOL,
  createNfseIssueHandler,
} from './tools/nfse-issue.tool';
import {
  NFSE_ISSUE_BATCH_TOOL,
  createNfseIssueBatchHandler,
} from './tools/nfse-issue-batch.tool';
import {
  NFSE_CANCEL_TOOL,
  createNfseCancelHandler,
} from './tools/nfse-cancel.tool';
import {
  NFSE_QUERY_TOOL,
  createNfseQueryHandler,
} from './tools/nfse-query.tool';
import { NFSE_LIST_TOOL, createNfseListHandler } from './tools/nfse-list.tool';
import {
  COMPANY_LIST_TOOL,
  createCompanyListHandler,
} from './tools/company-list.tool';
import {
  NFSE_DOWNLOAD_PDF_TOOL,
  createNfseDownloadPdfHandler,
} from './tools/nfse-download-pdf.tool';
import {
  NFSE_GET_DOWNLOAD_URL_TOOL,
  createNfseGetDownloadUrlHandler,
} from './tools/nfse-get-download-url.tool';
import {
  COMPANY_CREATE_TOOL,
  createCompanyCreateHandler,
} from './tools/company-create.tool';
import {
  NFSE_CALCULATE_TOOL,
  createNfseCalculateHandler,
} from './tools/nfse-calculate.tool';
import {
  BILLING_USAGE_TOOL,
  createBillingUsageHandler,
} from './tools/billing-usage.tool';
import {
  COMPANY_GET_TOOL,
  createCompanyGetHandler,
} from './tools/company-get.tool';

import {
  CUSTOMER_DELETE_TOOL,
  CUSTOMER_LIST_TOOL,
  CUSTOMER_UPDATE_TOOL,
  createCustomerDeleteHandler,
  createCustomerListHandler,
  createCustomerUpdateHandler,
} from './tools/customer.tools';
import {
  NFSE_SUBSTITUTE_TOOL,
  createNfseSubstituteHandler,
} from './tools/nfse-substitute.tool';
import { CustomerDirectory } from '@/modules/invoice/domain/customer-directory';
import { InvoiceSubstitutionService } from '@/modules/invoice/application/invoice-substitution.service';
import { InvoicePackageService } from '@/modules/invoice/application/package/invoice-package.service';
import { PackageLinkService } from '@/modules/invoice/application/package/package-link.service';
import {
  NFSE_GET_PACKAGE_URL_TOOL,
  createNfseGetPackageUrlHandler,
} from './tools/nfse-get-package-url.tool';

import {
  NFSE_REPEAT_TOOL,
  createNfseRepeatHandler,
} from './tools/nfse-repeat.tool';
import {
  NFSE_EMAIL_RESEND_TOOL,
  createNfseEmailResendHandler,
} from './tools/nfse-email-resend.tool';
import {
  COMPANY_UPDATE_TOOL,
  createCompanyUpdateHandler,
} from './tools/company-update.tool';
import {
  ACCOUNTANT_PACKAGE_SEND_TOOL,
  createAccountantPackageSendHandler,
} from './tools/accountant-package-send.tool';
import {
  SERVICE_FAVORITE_CREATE_TOOL,
  SERVICE_FAVORITE_DELETE_TOOL,
  SERVICE_FAVORITE_LIST_TOOL,
  createServiceFavoriteCreateHandler,
  createServiceFavoriteDeleteHandler,
  createServiceFavoriteListHandler,
} from './tools/service-favorite.tools';
import { AccountantPackageService } from '@/modules/invoice/application/package/accountant-package.service';
import { ServiceFavoritesService } from '@/modules/service-favorites/application/service-favorites.service';
import { InvoiceOverviewService } from '@/modules/invoice/application/invoice-overview.service';
import { BillingUsageService } from '@/modules/billing/application/billing-usage.service';
import { CreditsService } from '@/modules/credits/application/credits.service';
import { CertificateService } from '@/modules/certificate/application/certificate.service';
import { CompanyFiscalProfileService } from '@/modules/company/application/company-fiscal-profile.service';
import { CompanyServiceTaxProfileService } from '@/modules/company/application/company-service-tax-profile.service';
import { SimplesRegistryPort } from '@/modules/company/domain/registry-check';
import {
  DPS_SEQUENCE_REPOSITORY,
  type IDpsSequenceRepository,
} from '@/modules/invoice/domain/dps-sequence';
import {
  INVOICES_OVERVIEW_TOOL,
  createInvoicesOverviewHandler,
} from './tools/invoices-overview.tool';
import {
  CREDITS_BALANCE_TOOL,
  createCreditsBalanceHandler,
} from './tools/credits-balance.tool';
import { NFSE_GET_TOOL, createNfseGetHandler } from './tools/nfse-get.tool';
import {
  COMPANY_FISCAL_STATUS_TOOL,
  createCompanyFiscalStatusHandler,
} from './tools/company-fiscal-status.tool';
import {
  CNPJ_LOOKUP_TOOL,
  createCnpjLookupHandler,
} from './tools/cnpj-lookup.tool';

type ToolHandler = (params: unknown, ctx: AuthContext) => Promise<unknown>;

/**
 * NestJS-injectable registry for the MCP server. It owns the singleton
 * `McpServer`, wires every tool to its real handler factory, and enforces
 * OAuth scopes before a handler runs.
 *
 * InvoiceModule exports the tenant-scoped INVOICE_REPOSITORY token.
 */
@Injectable()
export class McpService {
  private readonly server: McpServer;

  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceBatchService: InvoiceBatchService,
    private readonly emissionRouter: EmissionRouterService,
    private readonly scheduleService: ScheduleService,
    private readonly importIntake: ImportIntakeService,
    private readonly importReview: ImportReviewService,
    private readonly importEmit: ImportEmitService,
    private readonly calculationService: InvoiceCalculationService,
    private readonly quotaService: QuotaService,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly companyService: CompanyService,
    @Inject(ICompanyCertificateReader)
    private readonly certReader: ICompanyCertificateReader,
    private readonly customers: CustomerDirectory,
    private readonly substitutions: InvoiceSubstitutionService,
    private readonly invoicePackages: InvoicePackageService,
    private readonly packageLinks: PackageLinkService,
    private readonly accountantPackages: AccountantPackageService,
    private readonly serviceFavorites: ServiceFavoritesService,
    private readonly invoiceOverview: InvoiceOverviewService,
    private readonly billingUsage: BillingUsageService,
    private readonly credits: CreditsService,
    private readonly certificates: CertificateService,
    private readonly fiscalProfiles: CompanyFiscalProfileService,
    private readonly serviceTaxProfiles: CompanyServiceTaxProfileService,
    private readonly cnpjRegistry: SimplesRegistryPort,
    @Inject(DPS_SEQUENCE_REPOSITORY)
    private readonly dpsSequences: IDpsSequenceRepository,
  ) {
    this.server = new McpServer();
    this.registerTools();
  }

  private registerTools(): void {
    // write tools: repeat, email, company update, accountant, favorites
    this.server.registerTool(
      NFSE_REPEAT_TOOL,
      this.wrapWithScopeCheck(
        createNfseRepeatHandler(this.emissionRouter, this.invoiceRepo),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      NFSE_EMAIL_RESEND_TOOL,
      this.wrapWithScopeCheck(
        createNfseEmailResendHandler(this.invoiceService),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      COMPANY_UPDATE_TOOL,
      this.wrapWithScopeCheck(
        createCompanyUpdateHandler(this.companyService),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      ACCOUNTANT_PACKAGE_SEND_TOOL,
      this.wrapWithScopeCheck(
        createAccountantPackageSendHandler(
          this.companyService,
          this.accountantPackages,
          this.invoicePackages,
        ),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      SERVICE_FAVORITE_LIST_TOOL,
      this.wrapWithScopeCheck(
        createServiceFavoriteListHandler(
          this.serviceFavorites,
          this.companyService,
        ),
        'nfse:read',
      ),
    );
    for (const [tool, handler] of [
      [
        SERVICE_FAVORITE_CREATE_TOOL,
        createServiceFavoriteCreateHandler(
          this.serviceFavorites,
          this.companyService,
        ),
      ],
      [
        SERVICE_FAVORITE_DELETE_TOOL,
        createServiceFavoriteDeleteHandler(
          this.serviceFavorites,
          this.companyService,
        ),
      ],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:write'),
      );
    // end of write tools block
    // nfse:write tools
    this.server.registerTool(
      NFSE_ISSUE_TOOL,
      this.wrapWithScopeCheck(
        createNfseIssueHandler(this.emissionRouter),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      NFSE_ISSUE_BATCH_TOOL,
      this.wrapWithScopeCheck(
        createNfseIssueBatchHandler(this.invoiceBatchService),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      NFSE_CANCEL_TOOL,
      this.wrapWithScopeCheck(
        createNfseCancelHandler(this.invoiceService),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      COMPANY_CREATE_TOOL,
      this.wrapWithScopeCheck(
        createCompanyCreateHandler(this.companyService),
        'nfse:write',
      ),
    );
    this.server.registerTool(
      NFSE_SUBSTITUTE_TOOL,
      this.wrapWithScopeCheck(
        createNfseSubstituteHandler(this.substitutions),
        'nfse:write',
      ),
    );
    for (const [tool, handler] of [
      [CUSTOMER_UPDATE_TOOL, createCustomerUpdateHandler(this.customers)],
      [CUSTOMER_DELETE_TOOL, createCustomerDeleteHandler(this.customers)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:write'),
      );
    this.server.registerTool(
      CUSTOMER_LIST_TOOL,
      this.wrapWithScopeCheck(
        createCustomerListHandler(this.customers),
        'nfse:read',
      ),
    );
    for (const [tool, handler] of [
      [SCHEDULE_UPDATE_TOOL, createScheduleUpdateHandler(this.scheduleService)],
      [SCHEDULE_PAUSE_TOOL, createSchedulePauseHandler(this.scheduleService)],
      [SCHEDULE_RESUME_TOOL, createScheduleResumeHandler(this.scheduleService)],
      [SCHEDULE_CANCEL_TOOL, createScheduleCancelHandler(this.scheduleService)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:write'),
      );
    for (const [tool, handler] of [
      [SCHEDULE_LIST_TOOL, createScheduleListHandler(this.scheduleService)],
      [SCHEDULE_GET_TOOL, createScheduleGetHandler(this.scheduleService)],
      [SCHEDULE_RUNS_TOOL, createScheduleRunsHandler(this.scheduleService)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:read'),
      );
    for (const [tool, handler] of [
      [IMPORT_CREATE_TOOL, createImportCreateHandler(this.importIntake)],
      [IMPORT_FIX_ROW_TOOL, createImportFixRowHandler(this.importReview)],
      [IMPORT_EMIT_TOOL, createImportEmitHandler(this.importEmit)],
      [IMPORT_DISCARD_TOOL, createImportDiscardHandler(this.importReview)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:write'),
      );
    for (const [tool, handler] of [
      [IMPORT_LIST_TOOL, createImportListHandler(this.importReview)],
      [IMPORT_GET_TOOL, createImportGetHandler(this.importReview)],
      [IMPORT_ROWS_TOOL, createImportRowsHandler(this.importReview)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:read'),
      );
    // nfse:read tools
    this.server.registerTool(
      COMPANY_LIST_TOOL,
      this.wrapWithScopeCheck(
        createCompanyListHandler(this.companyService, this.certReader),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      COMPANY_GET_TOOL,
      this.wrapWithScopeCheck(
        createCompanyGetHandler(this.companyService, this.certReader),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_CALCULATE_TOOL,
      this.wrapWithScopeCheck(
        createNfseCalculateHandler(this.calculationService),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      BILLING_USAGE_TOOL,
      this.wrapWithScopeCheck(
        createBillingUsageHandler(this.quotaService),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_QUERY_TOOL,
      this.wrapWithScopeCheck(
        createNfseQueryHandler(this.invoiceRepo),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_LIST_TOOL,
      this.wrapWithScopeCheck(
        createNfseListHandler(this.invoiceService),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_DOWNLOAD_PDF_TOOL,
      this.wrapWithScopeCheck(
        createNfseDownloadPdfHandler(this.invoiceService, this.invoiceRepo),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_GET_DOWNLOAD_URL_TOOL,
      this.wrapWithScopeCheck(
        createNfseGetDownloadUrlHandler(this.invoiceService, this.invoiceRepo),
        'nfse:read',
      ),
    );
    this.server.registerTool(
      NFSE_GET_PACKAGE_URL_TOOL,
      this.wrapWithScopeCheck(
        createNfseGetPackageUrlHandler(
          this.companyService,
          this.invoicePackages,
          this.packageLinks,
        ),
        'nfse:read',
      ),
    );
    // read tools: overview, credits, invoice detail, company fiscal, cnpj, review
    for (const [tool, handler] of [
      [
        INVOICES_OVERVIEW_TOOL,
        createInvoicesOverviewHandler(this.invoiceOverview),
      ],
      [
        CREDITS_BALANCE_TOOL,
        createCreditsBalanceHandler(this.billingUsage, this.credits),
      ],
      [NFSE_GET_TOOL, createNfseGetHandler(this.invoiceService)],
      [
        COMPANY_FISCAL_STATUS_TOOL,
        createCompanyFiscalStatusHandler(
          this.companyService,
          this.fiscalProfiles,
          this.serviceTaxProfiles,
          this.certificates,
          this.dpsSequences,
        ),
      ],
      [CNPJ_LOOKUP_TOOL, createCnpjLookupHandler(this.cnpjRegistry)],
    ] as const)
      this.server.registerTool(
        tool,
        this.wrapWithScopeCheck(handler, 'nfse:read'),
      );
  }

  private wrapWithScopeCheck(
    handler: ToolHandler,
    requiredScope: string,
  ): ToolHandler {
    return async (params: unknown, ctx: AuthContext) => {
      const scopes = ctx.scope?.split(' ') ?? [];
      if (!scopes.includes(requiredScope)) {
        throw new Error(`Forbidden: requires scope '${requiredScope}'`);
      }
      return handler(params, ctx);
    };
  }

  getServer(): McpServer {
    return this.server;
  }
}
