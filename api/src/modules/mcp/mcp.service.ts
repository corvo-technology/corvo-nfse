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
    private readonly calculationService: InvoiceCalculationService,
    private readonly quotaService: QuotaService,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    private readonly companyService: CompanyService,
    @Inject(ICompanyCertificateReader)
    private readonly certReader: ICompanyCertificateReader,
  ) {
    this.server = new McpServer();
    this.registerTools();
  }

  private registerTools(): void {
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
