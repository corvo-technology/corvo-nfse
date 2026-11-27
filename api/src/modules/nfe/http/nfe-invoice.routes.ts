import {
  Inject,
  Injectable,
  StreamableFile,
  type OnModuleInit,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  type InvoiceCall,
  type InvoiceRoutes,
  rejectNfseOnlyFilters,
  type ResponseLike,
} from '@/modules/fiscal-core/application/invoice-routes';
import { InvoiceTypeRouter } from '@/modules/fiscal-core/application/invoice-type.router';
import { data } from '@/shared/http/response';
import { validateDto } from '@/shared/http/validate-dto';
import { NfeCancelService } from '../application/nfe-cancel.service';
import { NfeConsultService } from '../application/nfe-consult.service';
import { NfeCorrectService } from '../application/nfe-correct.service';
import { nfeNotFound } from '../application/nfe-errors';
import { NfeFilesService } from '../application/nfe-files.service';
import {
  NfeIntakeService,
  type NfeSubmitted,
} from '../application/nfe-intake.service';
import { NfeInutilizeService } from '../application/nfe-inutilize.service';
import { NfeResubmitService } from '../application/nfe-resubmit.service';
import { NfeTimelineService } from '../application/nfe-timeline.service';
import {
  NfeValidateService,
  type NfeValidationResult,
} from '../application/nfe-validate.service';
import { INfeDocumentRepository } from '../domain/nfe-document.repository';
import { TypeormNfeInutilizations } from '../infra/typeorm-nfe-inutilizations';
import { NfeNumberGapsQuery } from '../infra/typeorm-nfe-number-gaps.query';
import { NfeRequestDto } from './nfe.dto';
import {
  CancelNfeDto,
  CorrectNfeDto,
  InutilizeNfeDto,
  ListInutilizationsQuery,
  NumberGapsQuery,
  toNfeEventResponse,
  toNfeInutilizationResponse,
  toNfeNumberGapResponse,
} from './nfe-event.dto';
import { ListNfeQuery, toNfeResponse } from './nfe-response.dto';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `type: "nfe"` names the route, it is not a field of the note. */
function withoutType(value: unknown): unknown {
  if (!isObject(value)) return value;
  const { type, ...rest } = value;
  return type === 'nfe' || type === undefined ? rest : value;
}

function accepted(result: NfeSubmitted, response: ResponseLike) {
  if (result.replayed) response.status(200);
  return {
    type: 'nfe' as const,
    id: result.id,
    status: result.status,
    ...(result.replayed ? { replayed: true as const } : {}),
  };
}

/**
 * The NF-e behind `/v1/invoices`: what the old `/v1/nfe` controllers did, now reached by the
 * `type` of the request or the type of the document. Permissions were checked by the router.
 */
@Injectable()
export class NfeInvoiceRoutes implements InvoiceRoutes, OnModuleInit {
  readonly type = 'nfe' as const;

  constructor(
    private readonly router: InvoiceTypeRouter,
    private readonly intake: NfeIntakeService,
    private readonly validation: NfeValidateService,
    private readonly consult: NfeConsultService,
    private readonly resubmission: NfeResubmitService,
    private readonly cancellation: NfeCancelService,
    private readonly correction: NfeCorrectService,
    private readonly timeline: NfeTimelineService,
    private readonly files: NfeFilesService,
    private readonly inutilization: NfeInutilizeService,
    private readonly inutilizations: TypeormNfeInutilizations,
    private readonly gaps: NfeNumberGapsQuery,
    @Inject(INfeDocumentRepository)
    private readonly documents: INfeDocumentRepository,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  async owns(id: string, call: InvoiceCall): Promise<boolean> {
    return (
      (await this.documents.findById(id, call.tenantId, call.environment, {
        model: 55,
      })) !== null
    );
  }

  async validate(body: unknown, includeXml: boolean, call: InvoiceCall) {
    const dto = await validateDto(NfeRequestDto, withoutType(body));
    return data<NfeValidationResult>(
      await this.validation.validate(
        call.tenantId,
        call.environment,
        dto,
        includeXml,
      ),
    );
  }

  async create(
    body: unknown,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
    res: ResponseLike,
  ) {
    const key = NfeIntakeService.assertIdempotencyKey(idempotencyKey);
    const dto = await validateDto(NfeRequestDto, withoutType(body));
    const result = await this.intake.submit(
      call.tenantId,
      call.environment,
      dto,
      key,
    );
    return data(accepted(result, res));
  }

  async list(query: Record<string, unknown>, call: InvoiceCall) {
    rejectNfseOnlyFilters(query, 'nfe');
    const { type: _type, ...rest } = query;
    const filters = await validateDto(
      ListNfeQuery,
      Object.fromEntries(
        Object.entries(rest).filter(([name]) =>
          ['limit', 'cursor', 'companyId', 'status'].includes(name),
        ),
      ),
      'query',
    );
    const page = await this.documents.list(call.tenantId, call.environment, {
      ...filters,
      model: 55,
    });
    return page.map((doc) => toNfeResponse(doc));
  }

  async get(id: string, call: InvoiceCall) {
    const doc = await this.documents.findById(
      id,
      call.tenantId,
      call.environment,
      { model: 55 },
    );
    if (!doc) throw nfeNotFound();
    return data(toNfeResponse(doc));
  }

  async resubmit(
    id: string,
    body: unknown,
    call: InvoiceCall,
    res: ResponseLike,
  ) {
    const dto = await validateDto(NfeRequestDto, withoutType(body));
    const result = await this.resubmission.resubmit(
      id,
      call.tenantId,
      call.environment,
      dto,
    );
    return data(accepted(result, res));
  }

  async discard(id: string, call: InvoiceCall) {
    return data(
      toNfeResponse(
        await this.resubmission.discard(id, call.tenantId, call.environment),
      ),
    );
  }

  async sync(id: string, call: InvoiceCall) {
    return data(
      toNfeResponse(
        await this.consult.sync(id, call.tenantId, call.environment, 'manual'),
      ),
    );
  }

  async cancel(id: string, body: unknown, call: InvoiceCall) {
    const dto = await validateDto(CancelNfeDto, body);
    return data(
      toNfeResponse(
        await this.cancellation.cancel(
          id,
          call.tenantId,
          call.environment,
          dto.justification,
        ),
      ),
    );
  }

  async correct(id: string, body: unknown, call: InvoiceCall) {
    const dto = await validateDto(CorrectNfeDto, body);
    return data(
      toNfeEventResponse(
        await this.correction.correct(
          id,
          call.tenantId,
          call.environment,
          dto.correction,
        ),
      ),
    );
  }

  async events(id: string, call: InvoiceCall) {
    return data(
      await this.timeline.timeline(id, call.tenantId, call.environment),
    );
  }

  async xml(id: string, call: InvoiceCall, res: Response): Promise<string> {
    const file = await this.files.read(
      id,
      call.tenantId,
      call.environment,
      'xml',
    );
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    return file.body.toString('utf8');
  }

  async pdf(
    id: string,
    call: InvoiceCall,
    res: Response,
  ): Promise<StreamableFile> {
    const file = await this.files.read(
      id,
      call.tenantId,
      call.environment,
      'pdf',
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    return new StreamableFile(file.body);
  }

  async downloadUrl(
    id: string,
    format: 'xml' | 'pdf',
    call: InvoiceCall,
    res: Response,
  ) {
    const result = await this.files.downloadUrl(
      id,
      call.tenantId,
      call.environment,
      format,
    );
    res.setHeader('Cache-Control', 'no-store');
    return data({
      downloadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      fileName: result.fileName,
      mimeType: result.mimeType,
    });
  }

  async createInutilization(
    body: unknown,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
    res: ResponseLike,
  ) {
    const dto = await validateDto(InutilizeNfeDto, withoutType(body));
    const result = await this.inutilization.create(
      call.tenantId,
      call.environment,
      dto,
      idempotencyKey,
    );
    if (result.replayed) res.status(200);
    return data({
      ...toNfeInutilizationResponse(result.inutilization),
      ...(result.replayed ? { replayed: true as const } : {}),
    });
  }

  async listInutilizations(query: Record<string, unknown>, call: InvoiceCall) {
    const { type: _type, ...rest } = query;
    const filters = await validateDto(ListInutilizationsQuery, rest, 'query');
    const page = await this.inutilizations.list(
      call.tenantId,
      call.environment,
      { ...filters, model: 55 },
    );
    return page.map(toNfeInutilizationResponse);
  }

  async numberGaps(query: Record<string, unknown>, call: InvoiceCall) {
    const { type: _type, ...rest } = query;
    const filters = await validateDto(NumberGapsQuery, rest, 'query');
    const found = await this.gaps.list(
      call.tenantId,
      call.environment,
      filters.companyId,
      55,
    );
    return data(found.map(toNfeNumberGapResponse));
  }
}
