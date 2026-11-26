import { Throttle } from '@nestjs/throttler';
import { InvoiceCalculationService } from '../application/fiscal/invoice-calculation.service';
import { calculationHttpFailure } from './fiscal-error-http';
import { InvoiceCalculationResponseDto } from './invoice-calculation-response.dto';
import { InvoiceResponseDto } from './invoice-response.dto';
import { data } from '@/shared/http/response';
import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { RawResponse } from '@/shared/http/response.interceptor';
import { CursorQuery } from '@/shared/http/pagination';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import {
  Controller,
  UseGuards,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Headers,
  Req,
  Res,
  HttpCode,
  StreamableFile,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOkResponse,
  ApiResponse,
  ApiOperation,
  ApiHeader,
  ApiExtraModels,
  ApiAcceptedResponse,
  ApiBody,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { InvoiceSubstitutionService } from '../application/invoice-substitution.service';
import { InvoiceService } from '../application/invoice.service';
import { InvoiceBatchService } from '../application/invoice-batch.service';
import { EmissionRouterService } from '@/modules/invoice-schedule/application/emission-router.service';
import { toScheduleResponse } from '@/modules/invoice-schedule/http/schedule.dto';
import {
  BatchInvoiceItemDto,
  CreateInvoiceBatchDto,
} from './invoice-batch.dto';
import { InvoiceBatchSummaryDto } from './invoice-batch-response.dto';
import {
  UntypedBody,
  rejectNfseOnlyFilters,
  type InvoiceCall,
  type InvoiceRoutes,
} from '@/modules/fiscal-core/application/invoice-routes';
import {
  InvoiceTypeRouter,
  type InvoiceGate,
} from '@/modules/fiscal-core/application/invoice-type.router';
import { RequireDocumentPermission } from '@/modules/auth/require-permission.decorator';
import { validateDto } from '@/shared/http/validate-dto';
import { UntypedBodyPipe } from './untyped-body.pipe';
import {
  CancelInvoiceDto,
  SubstituteInvoiceDto,
  CreateInvoiceDto,
  GetDownloadUrlDto,
  ListInvoicesQuery,
  RequestInvoiceEmailDto,
} from './invoice.dto';

const VIEW: InvoiceGate = {
  nfse: 'nfse.invoices.view',
  nfe: 'nfe.documents.view',
};
const ISSUE: InvoiceGate = {
  nfse: 'nfse.invoices.issue',
  nfe: 'nfe.documents.issue',
};
const CANCEL: InvoiceGate = {
  nfse: 'nfse.invoices.issue',
  nfe: 'nfe.documents.manage',
};

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly calculationService: InvoiceCalculationService,
    private readonly batchService: InvoiceBatchService,
    private readonly emissionRouter: EmissionRouterService,
    private readonly substitutions: InvoiceSubstitutionService,
    @Optional() private readonly types?: InvoiceTypeRouter,
  ) {}

  private callOf(req: RequestWithAuthContext): InvoiceCall {
    const auth = req.authContext!;
    return {
      tenantId: auth.activeTenantId,
      environment: executionEnvironment(auth),
      auth,
    };
  }

  /** NFS-e by default; the NF-e takes the call when the document with the id is an NF-e. */
  private byId<T>(
    id: string,
    req: RequestWithAuthContext,
    gate: InvoiceGate,
    nfse: () => Promise<T>,
    other: (routes: InvoiceRoutes, call: InvoiceCall) => Promise<T>,
  ): Promise<T> {
    if (!this.types) return nfse();
    const call = this.callOf(req);
    return this.types.byId(id, call, gate, nfse, (routes) =>
      other(routes, call),
    );
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post()
  @HttpCode(202)
  @ApiExtraModels(InvoiceResponseDto)
  @ApiAcceptedResponse({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceResponseDto) },
      },
    },
  })
  @ApiKeyEndpoint()
  @RequireDocumentPermission(ISSUE)
  @ApiOperation({
    summary: 'Emit a new NFS-e invoice, or schedule it (SCHEDULE / RECURRING)',
  })
  @ApiBody({ type: CreateInvoiceDto })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async emit(
    @Body() dto: CreateInvoiceDto,
    @Req() req: RequestWithAuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const bodyType = (dto as { type?: string }).type;
    if ((bodyType === 'nfe' || bodyType === 'nfce') && this.types) {
      // The validation pipe let it through untouched: NF-e and NFC-e validate their own body.
      const call = this.callOf(req);
      const routes = await this.types.forType(bodyType, call, ISSUE.nfe);
      return routes.create(dto, idempotencyKey, call, res!);
    }
    this.types?.assertNfse(this.callOf(req), ISSUE);
    const tenantId = req.authContext!.activeTenantId;
    const emitted = await this.emissionRouter.emit(
      dto,
      tenantId,
      req.authContext!,
      idempotencyKey,
    );
    // SCHEDULE and RECURRING issue nothing yet: the answer is the schedule, not an invoice.
    return emitted.kind === 'invoice'
      ? emitted.invoice
      : data(toScheduleResponse(emitted.schedule));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('batches')
  @HttpCode(202)
  @ApiExtraModels(BatchInvoiceItemDto, InvoiceBatchSummaryDto)
  @ApiAcceptedResponse({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceBatchSummaryDto) },
      },
    },
  })
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Emit up to 50 NFS-e in one request',
    description:
      'Accepts 1 to 50 invoices, for one company or several. Each item has the same fields as POST /invoices plus an optional `idempotencyKey`. ' +
      'Items are validated one by one: an invalid item is returned as `rejected` (with `error.code` and `error.message`) and is NOT saved, while the valid ones are saved together in a single transaction. ' +
      'The response has one result per item, in the order sent (`index`). ' +
      'Send an `idempotencyKey` per item: repeating the batch returns the invoices already saved (`replayed: true`) and only retries the rejected ones. The `Idempotency-Key` header does not apply here. ' +
      'In `live`, each accepted item reserves one credit; items beyond the plan limit are rejected with the limit error. ' +
      'Like POST /invoices, issuance is asynchronous: follow each invoice by id or webhook.',
  })
  @ApiResponse({
    status: 400,
    description:
      'The body is not a list of 1 to 50 invoices (ERROR_VALIDATION)',
  })
  @ApiResponse({
    status: 429,
    description:
      'Rate limit exceeded (10 batches per minute); Retry-After in seconds',
  })
  async emitBatch(
    @Body() dto: CreateInvoiceBatchDto,
    @Req() req: RequestWithAuthContext,
  ) {
    const auth = req.authContext!;
    return this.batchService.emitBatch(dto.invoices, auth.activeTenantId, auth);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('calculate')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Calculate taxes before issuing an invoice',
    description:
      'Always available with nfse.invoices.issue. Uses the emission request body; future competence is limited to OUTBOX_SCHEDULE_MAX_DAYS (15 days by default). Fiscal failures return 200 blocked with partial results. No credit, DPS number or document is reserved.',
  })
  @ApiOkResponse({ type: InvoiceCalculationResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Company not found in the tenant and environment',
  })
  @ApiResponse({ status: 422, description: 'Invalid request input' })
  @ApiResponse({
    status: 429,
    description:
      'Authenticated API rate limit exceeded; Retry-After in seconds and X-RateLimit-* headers',
  })
  @ApiResponse({
    status: 503,
    description: 'RTC Calculator unavailable; Retry-After in seconds',
  })
  async calculate(
    @Body() dto: CreateInvoiceDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = req.authContext;
    if (!auth) throw new UnauthorizedException();
    const outcome = await this.calculationService.calculate(
      dto,
      auth.activeTenantId,
      executionEnvironment(auth),
    );
    if ('httpError' in outcome) {
      const failure = calculationHttpFailure(outcome.httpError);
      if (failure.retryAfterSeconds !== undefined)
        res.setHeader('Retry-After', failure.retryAfterSeconds);
      throw failure.exception;
    }
    return data(outcome.response);
  }

  @Get()
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'List invoices for the tenant' })
  @ApiCursorResponse()
  async list(
    @Query() query: ListInvoicesQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    if (
      this.types &&
      (query.type === 'nfe' || query.type === 'nfce' || query.type === 'all')
    ) {
      const call = this.callOf(req);
      const raw = { ...query } as Record<string, unknown>;
      if (query.type === 'nfe' || query.type === 'nfce')
        return (await this.types.forType(query.type, call, VIEW.nfe)).list(
          raw,
          call,
        );
      rejectNfseOnlyFilters(raw, 'all');
      return this.types.summaries(
        {
          companyId: query.companyId,
          status: query.status,
          limit: query.limit,
          cursor: query.cursor,
        },
        call,
        VIEW,
      );
    }
    this.types?.assertNfse(this.callOf(req), VIEW);
    const tenantId = req.authContext!.activeTenantId;
    return this.invoiceService.list(
      tenantId,
      query,
      executionEnvironment(req.authContext!),
    );
  }

  @Get(':id')
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'Get invoice by ID' })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    return this.byId(
      id,
      req,
      VIEW,
      () =>
        this.invoiceService.findById(
          id,
          req.authContext!.activeTenantId,
          executionEnvironment(req.authContext!),
        ),
      (routes, call) => routes.get(id, call),
    );
  }

  @RawResponse()
  @Get(':id/xml')
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'Download invoice XML' })
  async getXml(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | string> {
    return this.byId(
      id,
      req,
      VIEW,
      () => this.nfseXml(id, req, res),
      (routes, call) => routes.xml(id, call, res),
    );
  }

  private async nfseXml(
    id: string,
    req: RequestWithAuthContext,
    res: Response,
  ): Promise<StreamableFile | string> {
    const tenantId = req.authContext!.activeTenantId;
    const xml = await this.invoiceService.getXml(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );

    const invoice = await this.invoiceService.findById(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );
    const snapshot = invoice.toSnapshot();
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfse-${snapshot.nfseNumber ?? id}.xml"`,
    );

    return xml;
  }

  @RawResponse()
  @Get(':id/pdf')
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'Download invoice PDF' })
  async getPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.byId(
      id,
      req,
      VIEW,
      () => this.nfsePdf(id, req, res),
      (routes, call) => routes.pdf(id, call, res),
    );
  }

  private async nfsePdf(
    id: string,
    req: RequestWithAuthContext,
    res: Response,
  ): Promise<StreamableFile> {
    const tenantId = req.authContext!.activeTenantId;
    const pdf = await this.invoiceService.getPdf(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );

    const invoice = await this.invoiceService.findById(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );
    const snapshot = invoice.toSnapshot();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="nfse-${snapshot.nfseNumber ?? id}.pdf"`,
    );

    return new StreamableFile(pdf);
  }

  @Get(':id/events')
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'Get invoice status transition events' })
  @ApiCursorResponse()
  async getEvents(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    return this.byId(
      id,
      req,
      VIEW,
      () =>
        this.invoiceService.getEventsPage(
          id,
          req.authContext!.activeTenantId,
          executionEnvironment(req.authContext!),
          options,
        ),
      (routes, call) => routes.events(id, call),
    );
  }

  @Post(':id/download-url')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequireDocumentPermission(VIEW)
  @ApiOperation({ summary: 'Get a signed download URL for invoice PDF or XML' })
  async getDownloadUrl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GetDownloadUrlDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.byId(
      id,
      req,
      VIEW,
      () => this.nfseDownloadUrl(id, dto, req, res),
      (routes, call) => routes.downloadUrl(id, dto.format, call, res),
    );
  }

  private async nfseDownloadUrl(
    id: string,
    dto: GetDownloadUrlDto,
    req: RequestWithAuthContext,
    res: Response,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const result = await this.invoiceService.getDownloadUrl(
      id,
      tenantId,
      dto.format,
      executionEnvironment(req.authContext!),
    );
    res.setHeader('Cache-Control', 'no-store');
    return data({
      downloadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      fileName: result.fileName,
      mimeType: result.mimeType,
    });
  }

  @Post(':id/email')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request invoice email to customer' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async requestEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto?: RequestInvoiceEmailDto,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const result = await this.invoiceService.requestEmail(
      id,
      tenantId,
      idempotencyKey,
      executionEnvironment(req.authContext!),
      dto?.email,
    );
    return data({
      emailId: result.emailId,
      status: result.status,
    });
  }

  @Post(':id/cancel')
  @HttpCode(202)
  @ApiExtraModels(InvoiceResponseDto)
  @ApiOkResponse({
    description: 'Queued invoice cancelled locally',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceResponseDto) },
      },
    },
  })
  @ApiAcceptedResponse({
    description:
      'NFS-e cancellation event is being processed (cancelling), or the cancellation request was registered on an invoice that is still being issued (processing, with cancellationRequestedAt set)',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceResponseDto) },
      },
    },
  })
  @ApiKeyEndpoint()
  @RequireDocumentPermission(CANCEL)
  @ApiBody({ type: CancelInvoiceDto })
  @ApiOperation({
    summary:
      'Cancel an invoice: 200 when a queued invoice is cancelled locally, 202 while the NFS-e cancellation event is processed or when the request is registered on a processing invoice',
    description:
      'A processing invoice (being issued) accepts the request with 202 and stays processing with cancellationRequestedAt set; description (15-255 characters) is required. When the invoice is authorized it is cancelled automatically at the Sefin (event 101101) and the credit is not refunded (cancelling an issued NFS-e does not refund credit); if the emission ends rejected or failed the request is discarded and the reservation is refunded as usual. Repeating the request returns the current state (the first request wins). retry_pending, reconciliation_required and manual_review return 409 ERROR_INVOICE_NOT_CANCELLABLE.',
  })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(UntypedBodyPipe) body: CancelInvoiceDto | UntypedBody,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.byId(
      id,
      req,
      CANCEL,
      async () => {
        // The global pipe cannot validate this body: an NF-e takes another one.
        const dto =
          body instanceof UntypedBody
            ? await validateDto(CancelInvoiceDto, body.raw)
            : body;
        const invoice = await this.invoiceService.cancel(
          id,
          req.authContext!.activeTenantId,
          executionEnvironment(req.authContext!),
          dto,
        );
        res.status(invoice.status === 'cancelled' ? 200 : 202);
        return invoice;
      },
      (routes, call) =>
        routes.cancel(id, body instanceof UntypedBody ? body.raw : body, call),
    );
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':id/substitute')
  @HttpCode(202)
  @ApiExtraModels(InvoiceResponseDto)
  @ApiAcceptedResponse({
    description:
      'The substitute invoice, queued. The original stays authorized until the Sefin authorizes the substitute.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { $ref: getSchemaPath(InvoiceResponseDto) },
      },
    },
  })
  @ApiHeader({ name: 'idempotency-key', required: false })
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({
    summary: 'Substitute an authorized invoice with a corrected one',
    description:
      'Issues a new NFS-e that replaces an authorized one. Only the service description, the purchase order and the notes can change: for MEI and Simples Nacional the Sefin refuses a substitute that changes the customer, the competence date or the amount (rule E0061). The original is cancelled only after the substitute is authorized; a refusal leaves it authorized. The substitute uses a credit like any issued invoice.',
  })
  async substitute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SubstituteInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuthContext,
  ) {
    return this.substitutions.substitute(
      id,
      req.authContext!.activeTenantId,
      executionEnvironment(req.authContext!),
      dto,
      idempotencyKey,
    );
  }
}
