import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import type {
  InvoiceCall,
  InvoiceRoutes,
  ResponseLike,
} from '@/modules/fiscal-core/application/invoice-routes';
import {
  InvoiceTypeRouter,
  invoiceOperationNotSupported,
} from '@/modules/fiscal-core/application/invoice-type.router';
import { INVOICE_TYPES } from '@/modules/fiscal-core/domain/invoice-type';
import { validateDto } from '@/shared/http/validate-dto';
import { InvoiceService } from '../application/invoice.service';

class InvoiceTypeRequired {
  @IsIn(INVOICE_TYPES)
  type!: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The operations of `/v1/invoices` that exist for NF-e only: the dry-run, resubmit, discard,
 * sync, correction letters, inutilizations and number gaps. An NFS-e (an `id` of one, or
 * `type: "nfse"`) answers 422 `INVOICE_OPERATION_NOT_SUPPORTED`.
 *
 * Declared before `InvoiceController` in the module: `GET /invoices/inutilizations` must not be
 * read as `GET /invoices/:id`.
 */
@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('invoices')
@Controller('invoices')
export class InvoiceTypesController {
  constructor(
    private readonly types: InvoiceTypeRouter,
    private readonly invoices: InvoiceService,
  ) {}

  private callOf(req: RequestWithAuthContext): InvoiceCall {
    const auth = req.authContext!;
    return {
      tenantId: auth.activeTenantId,
      environment: executionEnvironment(auth),
      auth,
    };
  }

  /** `type` is required and has to be `nfe`: NFS-e has no such operation. */
  private async nfeRoutes(
    type: unknown,
    req: RequestWithAuthContext,
    permission:
      'nfe.documents.issue' | 'nfe.documents.manage' | 'nfe.documents.view',
    unsupported: string,
  ): Promise<{ routes: InvoiceRoutes; call: InvoiceCall }> {
    const checked = await validateDto(InvoiceTypeRequired, { type });
    if (checked.type === 'nfse')
      throw invoiceOperationNotSupported(unsupported);
    const call = this.callOf(req);
    return { routes: await this.types.forType('nfe', call, permission), call };
  }

  /** The id has to be an NF-e: another kind is told the operation does not exist for it. */
  private async nfeById<T>(
    id: string,
    req: RequestWithAuthContext,
    permission: 'nfe.documents.issue' | 'nfe.documents.manage',
    unsupported: string,
    run: (routes: InvoiceRoutes, call: InvoiceCall) => Promise<T>,
  ): Promise<T> {
    const call = this.callOf(req);
    const routes = await this.types.owner(id, call, permission);
    if (routes) return run(routes, call);
    // 404 when there is no such document; 422 when it is an NFS-e.
    await this.invoices.findById(id, call.tenantId, call.environment);
    throw invoiceOperationNotSupported(unsupported);
  }

  @Post('validate')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Validate an NF-e without sending it' })
  @ApiQuery({ name: 'includeXml', required: false, type: Boolean })
  async validate(
    @Body() body: Record<string, unknown>,
    @Query('includeXml') includeXml: string | undefined,
    @Req() req: RequestWithAuthContext,
  ) {
    const { routes, call } = await this.nfeRoutes(
      isObject(body) ? body.type : undefined,
      req,
      'nfe.documents.issue',
      'There is no dry-run for an NFS-e here: use POST /invoices/calculate to preview its taxes',
    );
    return routes.validate(body, includeXml === 'true', call);
  }

  @Post('inutilizations')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Inutilize a range of NF-e numbers' })
  @ApiHeader({ name: 'idempotency-key', required: false })
  async createInutilization(
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const { routes, call } = await this.nfeRoutes(
      isObject(body) ? body.type : undefined,
      req,
      'nfe.documents.manage',
      'Number inutilization exists only for NF-e: an NFS-e has no numbers to void',
    );
    return routes.createInutilization(body, idempotencyKey, call, res);
  }

  @Get('inutilizations')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'List NF-e inutilizations, newest first' })
  async listInutilizations(
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuthContext,
  ) {
    const { routes, call } = await this.nfeRoutes(
      query.type,
      req,
      'nfe.documents.view',
      'Number inutilization exists only for NF-e',
    );
    return routes.listInutilizations(query, call);
  }

  @Get('number-gaps')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.view')
  @ApiOperation({
    summary: 'Numbers that no NF-e uses and no inutilization covers',
  })
  async numberGaps(
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuthContext,
  ) {
    const { routes, call } = await this.nfeRoutes(
      query.type,
      req,
      'nfe.documents.view',
      'Number gaps exist only for NF-e',
    );
    return routes.numberGaps(query, call);
  }

  @Put(':id')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Correct and send a rejected NF-e again' })
  async resubmit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithAuthContext,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    return this.nfeById(
      id,
      req,
      'nfe.documents.issue',
      'Only an NF-e can be corrected and sent again: to change an NFS-e use POST /invoices/{id}/substitute',
      (routes, call) => routes.resubmit(id, body, call, res),
    );
  }

  @Post(':id/sync')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Ask the SEFAZ about the NF-e by its key' })
  async sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    return this.nfeById(
      id,
      req,
      'nfe.documents.manage',
      'Consulting by key exists only for NF-e: an NFS-e is reconciled by Corvo itself',
      (routes, call) => routes.sync(id, call),
    );
  }

  @Post(':id/discard')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Give up a rejected NF-e' })
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAuthContext,
  ) {
    return this.nfeById(
      id,
      req,
      'nfe.documents.manage',
      'Only an NF-e can be discarded: its number has to be inutilized',
      (routes, call) => routes.discard(id, call),
    );
  }

  @Post(':id/corrections')
  @HttpCode(202)
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.manage')
  @ApiOperation({ summary: 'Send a correction letter (CC-e)' })
  async correct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: RequestWithAuthContext,
  ) {
    return this.nfeById(
      id,
      req,
      'nfe.documents.manage',
      'A correction letter does not exist for an NFS-e: to change one use POST /invoices/{id}/substitute',
      (routes, call) => routes.correct(id, body, call),
    );
  }
}
