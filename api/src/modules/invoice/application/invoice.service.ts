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
  BadRequestException,
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
  InvoiceNotFoundError,
  IdempotencyConflictError,
} from '../domain/errors';
import type { Company } from '@/modules/company/domain/company';
import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { CompanyService } from '@/modules/company/application/company.service';
import { CertificateService } from '@/modules/certificate/application/certificate.service';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import { CreateInvoiceDto, ListInvoicesQuery } from '../http/invoice.dto';
import type { DocumentFormat } from '@/infra/storage/domain/document-storage';
import {
  DOCUMENT_STORAGE,
  type IDocumentStorage,
} from '@/infra/storage/domain/document-storage';
import { InvoiceDomainService } from '../domain/invoice-domain.service';

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
    private readonly invoiceDomain: InvoiceDomainService,
  ) {}

  async emit(
    dto: CreateInvoiceDto,
    tenantId: string,
    authContext: AuthContext,
    idempotencyKeyHeader?: string,
  ): Promise<Invoice> {
    const environment = executionEnvironment(authContext);

    // Hash computed on ORIGINAL request body (before normalization).
    const requestHash = hashPayload({
      ...dto,
      competenceDate: new Date(dto.competenceDate).toISOString().slice(0, 10),
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
          return existing;
        } else {
          throw new IdempotencyConflictError(idempotencyKeyHeader);
        }
      }
    }

    // 2. Fiscal validation + normalization via domain service
    // Throws FiscalValidationError (→ 422 with code + details) on failure.
    const company = await this.resolveCompany(dto, tenantId, environment);
    if (!/^\d{7}$/.test(company.municipalityCode ?? '')) {
      throw new FiscalValidationError([
        {
          field: 'company.municipalityCode',
          code: 'required',
          message:
            'Configure a valid municipalityCode on the company before issuing invoices',
        },
      ]);
    }
    const normalized = this.invoiceDomain.normalizeAndValidate(
      { ...dto, companyId: company.id },
      environment,
      {
        code: company.defaultServiceCode,
        municipalityCode: company.municipalityCode,
      },
    );

    // 3. Ensure company is ready
    if (environment === 'live') {
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

    // 4. Create invoice with normalized values
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
            }
          : null,
        service: {
          description: normalized.service.description ?? '',
          code: normalized.service.code,
          municipalityCode: normalized.service.municipalityCode,
          fiscal: normalized.service.fiscal,
          serviceProfileId: normalized.service.serviceProfileId,
        },
        amount: normalized.amount,
        discount: normalized.discount,
        competenceDate: normalized.competenceDate,
      },
      tenantId,
      idempotencyKeyHeader,
    );

    const event = InvoiceEvent.create(invoice.id, null, 'queued');
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
      `Invoice ${invoice.id} emitted for company ${normalized.companyId}`,
    );
    return invoice;
  }

  /**
   * At least one of `companyId` or `companyTaxId` (CNPJ) is required. When both
   * are sent, `companyId` wins. Throws CompanyNotFoundError when the CNPJ
   * matches no company for this tenant and environment.
   */
  private async resolveCompany(
    dto: CreateInvoiceDto,
    tenantId: string,
    environment: ExecutionEnvironment,
  ): Promise<Company> {
    if (dto.companyId)
      return this.companyService.findById(dto.companyId, tenantId, environment);
    if (!dto.companyTaxId)
      throw new BadRequestException('companyId or companyTaxId is required');
    const company = await this.companyService.findByTaxId(
      dto.companyTaxId,
      tenantId,
      environment,
    );
    return company;
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

  async getXml(
    id: string,
    tenantId: string,
    environment: ExecutionEnvironment = 'test',
  ): Promise<string> {
    const invoice = await this.findById(id, tenantId, environment);

    if (invoice.status !== 'authorized') {
      throw new NotFoundException(
        'XML not available for non-authorized invoice',
      );
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

    if (invoice.status !== 'authorized') {
      throw new NotFoundException(
        'PDF not available for non-authorized invoice',
      );
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
        throw new NotFoundException(e.message);
      }
      throw e;
    }

    if (invoice.status !== 'authorized' || !invoice.documentsReadyAt) {
      throw new ConflictException('Documents not ready');
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
      throw new ServiceUnavailableException('Storage unavailable');
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
        throw new NotFoundException(e.message);
      }
      throw e;
    }

    if (invoice.status !== 'authorized' || !invoice.documentsReadyAt) {
      throw new ConflictException('Documents not ready');
    }

    const snapshot = invoice.toSnapshot();
    const customerEmail = snapshot.customerSnapshot?.email;

    if (!customerEmail) {
      throw new UnprocessableEntityException('Customer has no email');
    }

    // Validate idempotency key format if provided
    if (idempotencyKey && !/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
      throw new UnprocessableEntityException('Invalid idempotency key format');
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
