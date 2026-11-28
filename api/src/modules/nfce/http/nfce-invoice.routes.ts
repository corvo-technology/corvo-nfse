import {
  Inject,
  Injectable,
  StreamableFile,
  type OnModuleInit,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  type InvoiceCall,
  type InvoicePdfOptions,
  type InvoiceRoutes,
  rejectNfseOnlyFilters,
  type ResponseLike,
} from '@/modules/fiscal-core/application/invoice-routes';
import {
  InvoiceTypeRouter,
  invoiceOperationNotSupported,
} from '@/modules/fiscal-core/application/invoice-type.router';
import { NfeCancelService } from '@/modules/nfe/application/nfe-cancel.service';
import { NfeConsultService } from '@/modules/nfe/application/nfe-consult.service';
import { nfeNotFound } from '@/modules/nfe/application/nfe-errors';
import { NfeFilesService } from '@/modules/nfe/application/nfe-files.service';
import {
  NfeIntakeService,
  type NfeSubmitted,
} from '@/modules/nfe/application/nfe-intake.service';
import { NfeInutilizeService } from '@/modules/nfe/application/nfe-inutilize.service';
import { NfeResendEmailService } from '@/modules/nfe/application/nfe-resend-email.service';
import { repeatRequest } from '@/modules/nfe/application/nfe-repeat';
import { NfeTimelineService } from '@/modules/nfe/application/nfe-timeline.service';
import type { NfeValidationResult } from '@/modules/nfe/application/nfe-validate.service';
import { INfeDocumentRepository } from '@/modules/nfe/domain/nfe-document.repository';
import {
  CancelNfeDto,
  InutilizeNfeDto,
  ListInutilizationsQuery,
  NumberGapsQuery,
  RepeatNfeDto,
  toNfeInutilizationResponse,
  toNfeNumberGapResponse,
} from '@/modules/nfe/http/nfe-event.dto';
import {
  ListNfeQuery,
  toNfeResponse,
} from '@/modules/nfe/http/nfe-response.dto';
import { TypeormNfeInutilizations } from '@/modules/nfe/infra/typeorm-nfe-inutilizations';
import { NfeNumberGapsQuery } from '@/modules/nfe/infra/typeorm-nfe-number-gaps.query';
import { data } from '@/shared/http/response';
import { validateDto } from '@/shared/http/validate-dto';
import { NfceOfflineService } from '../application/nfce-offline.service';
import { NfceIntakeService } from '../application/nfce-intake.service';
import { NfceResubmitService } from '../application/nfce-resubmit.service';
import { NfceValidateService } from '../application/nfce-validate.service';
import { NfceRequestDto } from './nfce.dto';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `type: "nfce"` names the route, it is not a field of the note. */
function withoutType(value: unknown): unknown {
  if (!isObject(value)) return value;
  const { type, ...rest } = value;
  return type === 'nfce' || type === undefined ? rest : value;
}

function accepted(result: NfeSubmitted, response: ResponseLike) {
  if (result.replayed) response.status(200);
  return {
    type: 'nfce' as const,
    id: result.id,
    status: result.status,
    ...(result.replayed ? { replayed: true as const } : {}),
  };
}

/**
 * The NFC-e behind `/v1/invoices`: the same services as the NF-e, with `model: 65`. Permissions
 * were checked by the router. There is no correction letter (Ajuste SINIEF 19/2016, cláusula 8ª).
 */
@Injectable()
export class NfceInvoiceRoutes implements InvoiceRoutes, OnModuleInit {
  readonly type = 'nfce' as const;

  constructor(
    private readonly router: InvoiceTypeRouter,
    private readonly intake: NfceIntakeService,
    private readonly offline: NfceOfflineService,
    private readonly validation: NfceValidateService,
    private readonly consult: NfeConsultService,
    private readonly resubmission: NfceResubmitService,
    private readonly cancellation: NfeCancelService,
    private readonly timeline: NfeTimelineService,
    private readonly files: NfeFilesService,
    private readonly inutilization: NfeInutilizeService,
    private readonly resending: NfeResendEmailService,
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
        model: 65,
      })) !== null
    );
  }

  async validate(body: unknown, includeXml: boolean, call: InvoiceCall) {
    const dto = await validateDto(NfceRequestDto, withoutType(body));
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
    const dto = await validateDto(NfceRequestDto, withoutType(body));
    // Off-line (`tpEmis` 9): the PDV asked for it, or the company turned the option on and the SEFAZ
    // cannot be reached. The note is complete at once; otherwise it is queued for the SEFAZ.
    const reason = await this.offline.reasonFor(
      call.tenantId,
      call.environment,
      dto,
    );
    if (reason === null) {
      const result = await this.intake.submit(
        call.tenantId,
        call.environment,
        dto,
        key,
      );
      return data(accepted(result, res));
    }
    const result = await this.offline.submit(
      call.tenantId,
      call.environment,
      dto,
      key,
      reason,
    );
    const doc = await this.documents.findById(
      result.id,
      call.tenantId,
      call.environment,
      { model: 65 },
    );
    if (!doc) throw nfeNotFound();
    res.status(result.replayed ? 200 : 201);
    return data({
      ...accepted(result, { status: () => undefined }),
      accessKey: doc.accessKey,
      qrCode: doc.toSnapshot().qrCode,
      xmlUrl: `/v1/invoices/${doc.id}/xml`,
      pdfUrl: `/v1/invoices/${doc.id}/pdf`,
    });
  }

  async list(query: Record<string, unknown>, call: InvoiceCall) {
    rejectNfseOnlyFilters(query, 'nfce');
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
      model: 65,
    });
    return page.map((doc) => toNfeResponse(doc));
  }

  async get(id: string, call: InvoiceCall) {
    const doc = await this.documents.findById(
      id,
      call.tenantId,
      call.environment,
      { model: 65 },
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
    const dto = await validateDto(NfceRequestDto, withoutType(body));
    const result = await this.resubmission.resubmit(
      id,
      call.tenantId,
      call.environment,
      dto,
    );
    return data(accepted(result, res));
  }

  async repeat(
    id: string,
    body: unknown,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
    res: ResponseLike,
  ) {
    const dto = await validateDto(RepeatNfeDto, body ?? {});
    const doc = await this.documents.findById(
      id,
      call.tenantId,
      call.environment,
      { model: 65 },
    );
    if (!doc) throw nfeNotFound();
    // The copy goes through the same DTO and checks as a sale typed by hand.
    return this.create(
      repeatRequest(doc, dto.additionalInfo),
      idempotencyKey,
      call,
      res,
    );
  }

  async email(
    id: string,
    email: string | undefined,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
  ) {
    return data(
      await this.resending.request(id, call.tenantId, call.environment, 65, {
        toEmail: email,
        idempotencyKey,
      }),
    );
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

  correct(): Promise<unknown> {
    return Promise.reject(
      invoiceOperationNotSupported(
        'A NFC-e has no correction letter (Ajuste SINIEF 19/2016, cláusula 8ª): cancel it and issue another',
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
    options?: InvoicePdfOptions,
  ): Promise<StreamableFile> {
    const file = await this.files.read(
      id,
      call.tenantId,
      call.environment,
      'pdf',
      { layout: options?.layout },
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
      { ...dto, model: 65 },
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
      { ...filters, model: 65 },
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
      65,
    );
    return data(found.map(toNfeNumberGapResponse));
  }
}
