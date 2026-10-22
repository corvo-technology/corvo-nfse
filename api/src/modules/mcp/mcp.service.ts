import {
  INVOICE_REPOSITORY,
  type IInvoiceRepository,
} from '@/modules/invoice/domain/invoice.repository';
import { CompanyService } from '@/modules/company/application/company.service';
import { ICompanyCertificateReader } from '@/modules/company/domain/i-company-certificate-reader';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context';
import { InvoiceService } from '../invoice/application/invoice.service';
import { McpServer } from './mcp.server';
import {
  NFSE_ISSUE_TOOL,
  createNfseIssueHandler,
} from './tools/nfse-issue.tool';
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
        createNfseIssueHandler(this.invoiceService),
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
    // nfse:read tools
    this.server.registerTool(
      COMPANY_LIST_TOOL,
      this.wrapWithScopeCheck(
        createCompanyListHandler(this.companyService, this.certReader),
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
