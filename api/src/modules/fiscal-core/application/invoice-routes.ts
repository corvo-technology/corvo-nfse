import { BadRequestException, type StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { InvoiceType } from '../domain/invoice-type';

/** Who asks, in which workspace and environment. */
export interface InvoiceCall {
  tenantId: string;
  environment: ExecutionEnvironment;
  auth: AuthContext;
}

export interface ResponseLike {
  status(code: number): unknown;
}

/** A request body that was not validated yet: the document it is for decides the DTO. */
export class UntypedBody {
  constructor(readonly raw: unknown) {}
}

/**
 * What a document type that is not NFS-e does behind `/v1/invoices`. NFS-e keeps its own routes
 * (`InvoiceController`); every other type registers one of these in `InvoiceTypeRouter`, and the
 * controllers hand the call over by the `type` of the request or by the type of the document.
 *
 * Bodies and queries arrive raw: each type validates them with its own DTOs. Permissions are not
 * checked here: the router did it before the call.
 */
export interface InvoiceRoutes {
  readonly type: Exclude<InvoiceType, 'nfse'>;
  /** Is there a document of this type with this id in the tenant and environment? */
  owns(id: string, call: InvoiceCall): Promise<boolean>;

  validate(
    body: unknown,
    includeXml: boolean,
    call: InvoiceCall,
  ): Promise<unknown>;
  create(
    body: unknown,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
    res: ResponseLike,
  ): Promise<unknown>;
  list(query: Record<string, unknown>, call: InvoiceCall): Promise<unknown>;
  get(id: string, call: InvoiceCall): Promise<unknown>;
  resubmit(
    id: string,
    body: unknown,
    call: InvoiceCall,
    res: ResponseLike,
  ): Promise<unknown>;
  discard(id: string, call: InvoiceCall): Promise<unknown>;
  sync(id: string, call: InvoiceCall): Promise<unknown>;
  cancel(id: string, body: unknown, call: InvoiceCall): Promise<unknown>;
  correct(id: string, body: unknown, call: InvoiceCall): Promise<unknown>;
  events(id: string, call: InvoiceCall): Promise<unknown>;
  xml(id: string, call: InvoiceCall, res: Response): Promise<string>;
  pdf(id: string, call: InvoiceCall, res: Response): Promise<StreamableFile>;
  downloadUrl(
    id: string,
    format: 'xml' | 'pdf',
    call: InvoiceCall,
    res: Response,
  ): Promise<unknown>;
  createInutilization(
    body: unknown,
    idempotencyKey: string | undefined,
    call: InvoiceCall,
    res: ResponseLike,
  ): Promise<unknown>;
  listInutilizations(
    query: Record<string, unknown>,
    call: InvoiceCall,
  ): Promise<unknown>;
  numberGaps(
    query: Record<string, unknown>,
    call: InvoiceCall,
  ): Promise<unknown>;
}

/** Filters that only NFS-e has: `type=nfe` and `type=all` refuse them instead of ignoring them. */
export const NFSE_ONLY_FILTERS = [
  'from',
  'to',
  'externalId',
  'customerTaxId',
  'origin',
] as const;

export function rejectNfseOnlyFilters(
  query: Record<string, unknown>,
  type: string,
): void {
  const found = NFSE_ONLY_FILTERS.filter((name) => query[name] !== undefined);
  if (found.length === 0) return;
  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'validation_error',
    message: 'Request validation failed',
    details: found.map((field) => ({
      field,
      code: 'unknown_field',
      message: `${field} is not a filter of type=${type}`,
    })),
  });
}
