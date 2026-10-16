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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOkResponse,
  ApiResponse,
  ApiOperation,
  ApiHeader,
  ApiExtraModels,
  ApiAcceptedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { InvoiceService } from '../application/invoice.service';
import {
  CreateInvoiceDto,
  GetDownloadUrlDto,
  ListInvoicesQuery,
} from './invoice.dto';

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly calculationService: InvoiceCalculationService,
  ) {}

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
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Emit a new NFS-e invoice' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async emit(
    @Body() dto: CreateInvoiceDto,
    @Req() req: RequestWithAuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    return this.invoiceService.emit(
      dto,
      tenantId,
      req.authContext!,
      idempotencyKey,
    );
  }

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
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'List invoices for the tenant' })
  @ApiCursorResponse()
  async list(
    @Query() query: ListInvoicesQuery,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    return this.invoiceService.list(
      tenantId,
      query,
      executionEnvironment(req.authContext!),
    );
  }

  @Get(':id')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Get invoice by ID' })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    return this.invoiceService.findById(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
    );
  }

  @RawResponse()
  @Get(':id/xml')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Download invoice XML' })
  async getXml(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
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
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Download invoice PDF' })
  async getPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
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
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Get invoice status transition events' })
  @ApiCursorResponse()
  async getEvents(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    return this.invoiceService.getEventsPage(
      id,
      tenantId,
      executionEnvironment(req.authContext!),
      options,
    );
  }

  @Post(':id/download-url')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'Get a signed download URL for invoice PDF or XML' })
  async getDownloadUrl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GetDownloadUrlDto,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: Response,
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
  @ApiHeader({ name: 'idempotency-key', required: false })
  async requestEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const tenantId = req.authContext!.activeTenantId;
    const result = await this.invoiceService.requestEmail(
      id,
      tenantId,
      idempotencyKey,
      executionEnvironment(req.authContext!),
    );
    return data({
      emailId: result.emailId,
      status: result.status,
    });
  }
}
