import {
  Inject,
  Injectable,
  type OnModuleInit,
  type StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  InvoiceCall,
  InvoiceRoutes,
  ResponseLike,
} from '@/modules/fiscal-core/application/invoice-routes';
import {
  InvoiceTypeRouter,
  invoiceOperationNotSupported,
} from '@/modules/fiscal-core/application/invoice-type.router';
import type { NfeValidationResult } from '@/modules/nfe/application/nfe-validate.service';
import { INfeDocumentRepository } from '@/modules/nfe/domain/nfe-document.repository';
import { data } from '@/shared/http/response';
import { validateDto } from '@/shared/http/validate-dto';
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

const notYet = () =>
  invoiceOperationNotSupported('NFC-e emission is not available yet');

/**
 * The NFC-e behind `/v1/invoices`. For now only the dry-run (`POST /invoices/validate`) works: the
 * other operations answer 422 `INVOICE_OPERATION_NOT_SUPPORTED` until the emission arrives.
 * Permissions were checked by the router.
 */
@Injectable()
export class NfceInvoiceRoutes implements InvoiceRoutes, OnModuleInit {
  readonly type = 'nfce' as const;

  constructor(
    private readonly router: InvoiceTypeRouter,
    private readonly validation: NfceValidateService,
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

  create(
    _body: unknown,
    _idempotencyKey: string | undefined,
    _call: InvoiceCall,
    _res: ResponseLike,
  ): Promise<unknown> {
    return Promise.reject(notYet());
  }

  list(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  get(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  resubmit(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  discard(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  sync(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  cancel(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  correct(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  events(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  xml(_id: string, _call: InvoiceCall, _res: Response): Promise<string> {
    return Promise.reject(notYet());
  }

  pdf(
    _id: string,
    _call: InvoiceCall,
    _res: Response,
  ): Promise<StreamableFile> {
    return Promise.reject(notYet());
  }

  downloadUrl(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  createInutilization(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  listInutilizations(): Promise<unknown> {
    return Promise.reject(notYet());
  }

  numberGaps(): Promise<unknown> {
    return Promise.reject(notYet());
  }
}
