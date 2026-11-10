import { NfseProviderFactory } from '@/infra/external/nfse/nfse-provider.factory';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';
import {
  QuotaService,
  QuotaExceededError,
  QuotaExceededReason,
} from '@/modules/plans/application/quota.service';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  ServiceUnavailableException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { Invoice } from '../domain/invoice';
import { InvoiceEvent } from '../domain/invoice-event';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { AuthContext } from '@/modules/auth/auth-context';
import {
  INVOICE_REPOSITORY,
  INVOICE_EVENT_REPOSITORY,
  ListInvoicesFilters,
} from '../domain/invoice.repository';
import type {
  IInvoiceRepository,
  IInvoiceEventRepository,
} from '../domain/invoice.repository';
import {
  ConcurrentInvoiceTransitionError,
  InvoiceNotCancellableError,
  InvoiceNotFoundError,
  IdempotencyConflictError,
} from '../domain/errors';
import { CompanyService } from '@/modules/company/application/company.service';
import { CertificateService } from '@/modules/certificate/application/certificate.service';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import {
  CancelInvoiceDto,
  CreateInvoiceDto,
  ListInvoicesQuery,
} from '../http/invoice.dto';
import {
  cancellationReason,
  DEFAULT_CANCELLATION_DESCRIPTION,
  type CancellationReason,
} from '../domain/cancellation-reason';
import { cancellationMessage } from './invoice-cancel.handler';
import { InvoiceWebhookPublisher } from './invoice-webhook.publisher';
import type { DocumentFormat } from '@/infra/storage/domain/document-storage';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { InvoiceIntakeService } from './invoice-intake.service';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';

export type PreparedEmission =
  | { kind: 'replay'; invoice: Invoice }
  | {
      kind: 'ready';
      invoice: Invoice;
      event: InvoiceEvent;
      requestHash: string;
    };

function hashPayload(payload: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    @Inject(INVOICE_EVENT_REPOSITORY)
    private readonly eventRepo: IInvoiceEventRepository,
    @Inject(DOCUMENT_STORAGE)
    private readonly documentStorage: IDocumentStorage,
    private readonly companyService: CompanyService,
    private readonly certificateService: CertificateService,
    private readonly queueService: BullmqQueueService,
    private readonly lifecycle: InvoiceLifecycleService,
    private readonly quotaService: QuotaService,
    private readonly intake: InvoiceIntakeService,
    private readonly webhooks: InvoiceWebhookPublisher,
    private readonly providers: NfseProviderFactory,
  ) {}

  async emit(
    dto: CreateInvoiceDto,
    tenantId: string,
    authContext: AuthContext,
    idempotencyKeyHeader?: string,
  ): Promise<Invoice> {
    return this.emitInEnvironment(
      dto,
      tenantId,
      executionEnvironment(authContext),
      idempotencyKeyHeader,
    );
  }

  /** Same as `emit` for callers that have no user session (integrations). */
  async emitInEnvironment(
    dto: CreateInvoiceDto,
    tenantId: string,
    environment: ExecutionEnvironment,
    idempotencyKeyHeader?: string,
  ): Promise<Invoice> {
    const prepared = await this.prepareEmissionInEnvironment(
      dto,
      tenantId,
      environment,
      idempotencyKeyHeader,
    );
    if (prepared.kind === 'replay') return prepared.invoice;
    const { invoice, event, requestHash } = prepared;

    const quota =
      environment === 'live'
        ? await this.quotaService.getStatus(tenantId)
        : undefined;
    if (quota?.reason === QuotaExceededReason.PLAN_BLOCKED)
      throw new QuotaExceededError(quota.reason, {});
    const dailyLimit = quota?.dailyLimit ?? null;
    try {
      await this.lifecycle.submit(invoice, event, dailyLimit);
    } catch (error) {
      if (
        idempotencyKeyHeader &&
        (error as { code?: string }).code === '23505'
      ) {
        const winner = await this.invoiceRepo.findByIdempotencyKey(
          idempotencyKeyHeader,
          tenantId,
          environment,
        );
        if (winner?.toSnapshot().requestHash === requestHash) {
          return winner;
        }
        throw new IdempotencyConflictError(idempotencyKeyHeader);
      }
      throw error;
    }

    this.logger.log(
      `Invoice ${invoice.id} emitted for company ${invoice.companyId}`,
    );
    return invoice;
  }

  /**
   * Everything `emit` does before writing: idempotency lookup, fiscal
   * validation, company/certificate checks and building the queued invoice
   * with its event. Nothing is persisted.
   */
  async prepareEmission(
    dto: CreateInvoiceDto,
    tenantId: string,
    authContext: AuthContext,
    idempotencyKeyHeader?: string,
  ): Promise<PreparedEmission> {
    return this.prepareEmissionInEnvironment(
      dto,
      tenantId,
      executionEnvironment(authContext),
      idempotencyKeyHeader,
    );
  }

  async prepareEmissionInEnvironment(
    dto: CreateInvoiceDto,
    tenantId: string,
    environment: ExecutionEnvironment,
    idempotencyKeyHeader?: string,
  ): Promise<PreparedEmission> {
    // `@IsDateString` accepts forms `Date` cannot parse (2026-W53, 2026-366): fail as validation, not as a crash.
    const competence = new Date(dto.competenceDate);
    if (Number.isNaN(competence.getTime()))
      throw new FiscalValidationError([
        {
          field: 'competenceDate',
          code: 'invalid_date',
          message: 'competenceDate must be a valid date',
        },
      ]);

    // Hash computed on ORIGINAL request body (before normalization).
    const requestHash = hashPayload({
      ...dto,
      competenceDate: competence.toISOString().slice(0, 10),
      email: { send: dto.email ?? false },
    });

    // 1. Validate idempotency if key provided
    if (idempotencyKeyHeader) {
      const existing = await this.invoiceRepo.findByIdempotencyKey(
        idempotencyKeyHeader,
        tenantId,
        environment,
      );

      if (existing) {
        const existingPayloadHash = existing.toSnapshot().requestHash;
        const newPayloadHash = requestHash;

        if (existingPayloadHash === newPayloadHash) {
          this.logger.log(
            `Idempotent request for key: ${idempotencyKeyHeader}`,
          );
          return { kind: 'replay', invoice: existing };
        } else {
          throw new IdempotencyConflictError(idempotencyKeyHeader);
        }
      }
    }

    // 2. Fiscal validation + normalization via domain service
    // Throws FiscalValidationError (→ 422 with code + details) on failure.
    const { normalized } = await this.intake.prepare(
      dto,
      tenantId,
      environment,
    );

    // 3. Ensure company is ready. Everything that reaches the Sefin (live, and test unless it is simulated)
    // is signed with the company's certificate.
    if (!this.providers.isSimulated(environment)) {
      await this.companyService.ensureReady(
        normalized.companyId,
        tenantId,
        environment,
      );
      await this.certificateService.getActive(
        normalized.companyId,
        tenantId,
        environment,
      );
    }

    // 4. Build the invoice with normalized values (not persisted here)
    const invoice = Invoice.create(
      {
        environment,
        requestHash,
        scheduledFor: normalized.scheduledFor,
        email: { send: normalized.emailSend },
        companyId: normalized.companyId,
        externalId: normalized.externalId,
        customer: normalized.customer
          ? {
              taxId: normalized.customer.taxId,
              name: normalized.customer.name,
              email: normalized.customer.email,
              address: {
                city: normalized.customer.address.city,
                state: normalized.customer.address.state,
                municipalityCode: normalized.customer.address.municipalityCode,
              },
              foreign: normalized.customer.foreign,
            }
          : null,
        service: {
          description: normalized.service.description ?? '',
          code: normalized.service.code,
          municipalityCode: normalized.service.municipalityCode,
          fiscal: normalized.service.fiscal,
          serviceProfileId: normalized.service.serviceProfileId,
          purchaseOrder: normalized.service.purchaseOrder,
          notes: normalized.service.notes,
        },
        amount: normalized.amount,
        discount: normalized.discount,
        deduction: normalized.deduction,
        competenceDate: normalized.competenceDate,
      },
      tenantId,
      idempotencyKeyHeader,
    );

    const event = InvoiceEvent.create(invoice.id, null, 'queued');
    return { kind: 'ready', invoice, event, requestHash };
  }

  async list(
    tenantId: string,
    query: ListInvoicesQuery,
    environment: ExecutionEnvironment = 'test',
  ): Promise<CursorPage<Invoice>> {
    const filters: ListInvoicesFilters = {
      environment,
      companyId: query.companyId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      externalId: query.externalId,
    };

    return this.invoiceRepo.listPage(tenantId, filters, query);
  }

  async findById(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findByIdAndTenantId(
      id,
      tenantId,
      environment,
    );
    if (!invoice) {
      throw new InvoiceNotFoundError(id);
    }
    return invoice;
  }

  /** Local for a queued invoice; otherwise requests the fiscal event and returns `cancelling`. */
  async cancel(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: CancelInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.findById(id, tenantId, environment);
    if (invoice.status === 'cancelling' || invoice.status === 'cancelled')
      return invoice;
    if (invoice.status === 'processing')
      return this.cancelWhileProcessing(
        invoice,
        cancellationReason(input.reason, input.description),
        input,
        environment,
      );
    const fiscal = invoice.status !== 'queued';
    const event = invoice.requestCancellation(
      cancellationReason(input.reason, input.description),
    );
    let applied: boolean;
    try {
      applied = await this.lifecycle.transition(
        invoice,
        event,
        fiscal ? cancellationMessage(invoice, event) : undefined,
      );
    } catch (error: unknown) {
      if (!(error instanceof ConcurrentInvoiceTransitionError)) throw error;
      return this.currentAfterLostRace(id, tenantId, environment, input);
    }
    if (!applied)
      return this.currentAfterLostRace(id, tenantId, environment, input);
    if (!fiscal)
      await this.webhooks.publish(invoice, 'nfse.invoice.cancelled', {
        reason: input.reason,
      });
    return invoice;
  }

  /**
   * Records the intent to cancel on an invoice still being issued: no transition,
   * outbox or webhook. The worker applies it when the Sefin authorizes. The reason
   * is validated here because the repository and `transition()` trust it.
   */
  private async cancelWhileProcessing(
    invoice: Invoice,
    reason: CancellationReason,
    input: CancelInvoiceDto,
    environment: ExecutionEnvironment,
  ): Promise<Invoice> {
    if (invoice.hasPendingCancellation) return invoice;
    invoice.registerPendingCancellation(reason); // validates 15-255 first
    const requestedAt = invoice.cancellationRequestedAt as Date;
    const written = await this.invoiceRepo.registerCancellationIntent(
      invoice.id,
      invoice.tenantId,
      { code: reason.code, description: reason.description, requestedAt },
    );
    if (written) return invoice;
    return this.currentAfterLostRace(
      invoice.id,
      invoice.tenantId,
      environment,
      input,
    );
  }

  /**
   * Lost a race: another request already cancelled it (return that state), the
   * worker authorized it (cancel fiscally), the worker took a queued one (register
   * the intent) or it is not cancellable (409).
   */
  private async currentAfterLostRace(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    input: CancelInvoiceDto,
  ): Promise<Invoice> {
    const current = await this.findById(id, tenantId, environment);
    if (current.status === 'cancelling' || current.status === 'cancelled')
      return current;
    if (current.status === 'authorized')
      return this.cancel(id, tenantId, environment, input);
    if (current.status === 'processing') {
      if (current.hasPendingCancellation) return current;
      const supplied = cancellationReason(input.reason, input.description);
      return this.cancelWhileProcessing(
        current,
        {
          code: supplied.code,
          description:
            supplied.description ??
            DEFAULT_CANCELLATION_DESCRIPTION[supplied.code],
        },
        input,
        environment,
      );
    }
    throw new InvoiceNotCancellableError(current.status);
  }

  async getXml(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<string> {
    const invoice = await this.findById(id, tenantId, environment);

    if (!invoice.wasAuthorized) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_AVAILABLE',
        message: 'XML not available for non-authorized invoice',
      });
    }

    return this.documentStorage.getXml(
      tenantId,
      id,
      invoice.storageEnvironment,
    );
  }

  async getPdf(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<Buffer> {
    const invoice = await this.findById(id, tenantId, environment);

    if (!invoice.wasAuthorized) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_AVAILABLE',
        message: 'PDF not available for non-authorized invoice',
      });
    }

    return this.documentStorage.getPdf(
      tenantId,
      id,
      invoice.storageEnvironment,
    );
  }

  async getEventsPage(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment,
    options: CursorQuery,
  ): Promise<CursorPage<InvoiceEvent>> {
    // First ensure the invoice exists and belongs to tenant
    await this.findById(id, tenantId, environment);
    return this.eventRepo.listPage(id, tenantId, options);
  }

  async getEvents(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<InvoiceEvent[]> {
    // First ensure the invoice exists and belongs to tenant
    await this.findById(id, tenantId, environment);
    return this.eventRepo.findByInvoiceId(id, tenantId);
  }

  async getDownloadUrl(
    id: string,
    tenantId: string,
    format: DocumentFormat,
    environment: ExecutionEnvironment = 'test',
  ): Promise<{
    url: string;
    expiresAt: Date;
    fileName: string;
    mimeType: string;
  }> {
    let invoice: Invoice;
    try {
      invoice = await this.findById(id, tenantId, environment);
    } catch (e) {
      if (e instanceof InvoiceNotFoundError) {
        throw new NotFoundException({
          code: 'INVOICE_NOT_FOUND',
          message: e.message,
        });
      }
      throw e;
    }

    if (!invoice.wasAuthorized || !invoice.documentsReadyAt) {
      throw new ConflictException({
        code: 'DOCUMENTS_NOT_READY',
        message: 'Documents not ready',
      });
    }

    const snapshot = invoice.toSnapshot();
    const fileName = `nfse-${snapshot.nfseNumber}.${format}`;

    try {
      const result = await this.documentStorage.getSignedUrl(
        tenantId,
        id,
        format,
        {
          fileName,
          expiresInSeconds: 3600,
        },
        invoice.storageEnvironment,
      );
      return {
        url: result.url,
        expiresAt: result.expiresAt,
        fileName: result.fileName,
        mimeType: result.mimeType,
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message: 'Storage unavailable',
      });
    }
  }

  async requestEmail(
    id: string,
    tenantId: string,
    idempotencyKey?: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<{ emailId: string; status: string }> {
    let invoice: Invoice;
    try {
      invoice = await this.findById(id, tenantId, environment);
    } catch (e) {
      if (e instanceof InvoiceNotFoundError) {
        throw new NotFoundException({
          code: 'INVOICE_NOT_FOUND',
          message: e.message,
        });
      }
      throw e;
    }

    if (invoice.status === 'cancelling' || invoice.status === 'cancelled') {
      throw new ConflictException({
        code: 'INVOICE_CANCELLED_NO_EMAIL',
        message: 'Invoice is cancelled; e-mail is not available',
      });
    }

    if (invoice.status !== 'authorized' || !invoice.documentsReadyAt) {
      throw new ConflictException({
        code: 'DOCUMENTS_NOT_READY',
        message: 'Documents not ready',
      });
    }

    const snapshot = invoice.toSnapshot();
    const customerEmail = snapshot.customerSnapshot?.email;

    if (!customerEmail) {
      throw new UnprocessableEntityException({
        code: 'CUSTOMER_EMAIL_MISSING',
        message: 'Customer has no email',
      });
    }

    // Validate idempotency key format if provided
    if (idempotencyKey && !/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Invalid idempotency key format',
      });
    }

    const emailId =
      idempotencyKey ?? `inv_${Date.now()}_${randomUUID().split('-')[0]}`;

    const jobId = `email-resend-${id}-${emailId}`;
    if (idempotencyKey) {
      const existing = await this.queueService
        .getQueue('nfse-email')
        .getJob(jobId);
      if (existing)
        return { emailId, status: invoice.lastEmailStatus ?? 'queued' };
    }

    await this.invoiceRepo.updateEmailStatus(id, tenantId, 'queued');

    await this.queueService.add(
      'nfse-email',
      'deliver',
      { invoiceId: id, tenantId },
      {
        idempotencyKey: jobId,
        attempts: 3,
        backoffMs: 5_000,
        removeOnComplete: false,
        removeOnFail: 1000,
      },
    );

    return { emailId, status: 'queued' };
  }

  async getStatus(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<{ status: InvoiceStatus; error?: string }> {
    const invoice = await this.findById(id, tenantId, environment);
    return {
      status: invoice.status,
      error:
        invoice.status === 'rejected' || invoice.status === 'failed'
          ? (invoice.toSnapshot().lastErrorMessage ?? undefined)
          : undefined,
    };
  }
}
