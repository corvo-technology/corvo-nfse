import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import type { IInvoiceEventRepository } from '../domain/invoice.repository';
import type { IDocumentStorage } from '@/infra/storage/domain/document-storage';
import { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { Mocked } from 'jest-mock';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { CertificateService } from '@/modules/certificate/application/certificate.service';
import { Invoice, type InvoiceProps } from '../domain/invoice';
import { Queue } from 'bullmq';

describe('InvoiceService — getDownloadUrl & requestEmail', () => {
  // Helper: build a minimal authorized invoice snapshot

  function makeAuthorizedInvoice(
    overrides?: Partial<InvoiceProps> & { customerEmail?: string },
  ): Invoice {
    const props = {
      id: 'inv-1',
      companyId: 'comp-1',
      tenantId: 'tenant-1',
      externalId: null,
      idempotencyKey: null,
      status: 'authorized' as const,
      customerSnapshot: {
        taxId: '12345678900',
        name: 'Cliente',
        email:
          'customerEmail' in (overrides ?? {})
            ? overrides?.customerEmail
            : 'cliente@test.com',
      },
      serviceSnapshot: {
        description: 'Servico',
        code: '0101',
        municipalityCode: '3550308',
      },
      taxSnapshot: {},
      amount: 100,
      currency: 'BRL',
      competenceDate: new Date(),
      dpsId: 'dps-1',
      dpsSeries: '1',
      dpsNumber: 1,
      accessKey: 'access-key-123',
      nfseNumber: 42,
      fiscalProvider: 'national',
      fiscalSchemaVersion: 'v2_02',
      issuedAt: new Date(),
      authorizedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorProvider: null,
      documentsReadyAt: new Date(),
      lastEmailStatus: null as 'queued' | 'sent' | 'failed' | null,
      lastEmailSentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const merged = { ...props, ...overrides };

    return Invoice.reconstitute(merged);
  }

  let invoiceRepo: jest.Mocked<IInvoiceRepository>;
  let eventRepo: jest.Mocked<IInvoiceEventRepository>;
  let documentStorage: jest.Mocked<IDocumentStorage>;
  let queueService: jest.Mocked<BullmqQueueService>;
  let companyService: jest.Mocked<CompanyService>;
  let certificateService: jest.Mocked<CertificateService>;

  let service: InvoiceService;
  // Module-level so tests can assert on the same mock queue instance
  let capturedQueueAddCalls: unknown[][] = [];

  beforeEach(() => {
    capturedQueueAddCalls = [];

    invoiceRepo = {
      findByIdAndTenantId: jest.fn(),
      save: jest.fn(),
      updateEmailStatus: jest.fn(),
    } as unknown as jest.Mocked<IInvoiceRepository>;

    eventRepo = {
      listPage: jest.fn(),
      findByInvoiceId: jest.fn(),
      save: jest.fn(),
    };

    documentStorage = {
      exists: jest.fn(),
      getSignedUrl: jest.fn(),
      getXml: jest.fn(),
      getPdf: jest.fn(),
    } as unknown as jest.Mocked<IDocumentStorage>;

    // Create a real BullmqQueueService with a mocked Queue for nfse-email
    const mockQueueInstance = {
      add: jest.fn((jobName: string, data: unknown, options?: unknown) => {
        capturedQueueAddCalls.push([jobName, data, options]);
        return Promise.resolve({
          id: 'job-1',
          queueName: 'nfse-email',
          jobName,
        });
      }),
      getJob: jest.fn(),
      removeJob: jest.fn(),
    } as unknown as Queue;

    const mockQueues = {
      'nfse-email': mockQueueInstance,
    } as unknown as Record<string, Queue>;

    queueService = new BullmqQueueService(mockQueues as never, {
      defaultAttempts: 3,
      defaultBackoffMs: 5000,
    }) as unknown as Mocked<BullmqQueueService>;

    companyService = {} as jest.Mocked<CompanyService>;
    certificateService = {} as jest.Mocked<CertificateService>;

    service = new InvoiceService(
      invoiceRepo,
      eventRepo,
      documentStorage,
      companyService,
      certificateService,
      queueService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { isSimulated: (environment: string) => environment !== 'live' } as never,
    );
  });

  // -------------------------------------------------------------------------
  // getDownloadUrl
  // -------------------------------------------------------------------------
  describe('getDownloadUrl', () => {
    it('returns 404 when invoice does not exist for tenant', async () => {
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl('inv-noex', 'tenant-1', 'pdf'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 409 when invoice was never authorized', async () => {
      const invoice = makeAuthorizedInvoice({
        status: 'queued',
        authorizedAt: null,
      });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(
        service.getDownloadUrl('inv-1', 'tenant-1', 'pdf'),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 409 when documents are not ready (documentsReadyAt is null)', async () => {
      const invoice = makeAuthorizedInvoice({ documentsReadyAt: null });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(
        service.getDownloadUrl('inv-1', 'tenant-1', 'pdf'),
      ).rejects.toThrow(ConflictException);
    });

    it('returns signed URL with correct fileName for pdf', async () => {
      const invoice = makeAuthorizedInvoice({ nfseNumber: 42 });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);
      const expiresAt = new Date(Date.now() + 3600_000);
      documentStorage.getSignedUrl.mockResolvedValue({
        url: 'https://storage.example.com/signed.pdf',
        expiresAt,
        fileName: 'nfse-42.pdf',
        mimeType: 'application/pdf',
      });

      const result = await service.getDownloadUrl('inv-1', 'tenant-1', 'pdf');

      expect(result.fileName).toBe('nfse-42.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(documentStorage.getSignedUrl).toHaveBeenCalledWith(
        'tenant-1',
        'inv-1',
        'pdf',
        expect.objectContaining({ fileName: 'nfse-42.pdf' }),
        'test',
      );
    });

    it('returns signed URL with correct fileName for xml', async () => {
      const invoice = makeAuthorizedInvoice({ nfseNumber: 99 });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);
      const expiresAt = new Date(Date.now() + 3600_000);
      documentStorage.getSignedUrl.mockResolvedValue({
        url: 'https://storage.example.com/signed.xml',
        expiresAt,
        fileName: 'nfse-99.xml',
        mimeType: 'application/xml',
      });

      const result = await service.getDownloadUrl('inv-1', 'tenant-1', 'xml');

      expect(result.fileName).toBe('nfse-99.xml');
      expect(result.mimeType).toBe('application/xml');
    });

    it('resolves for a cancelled invoice that was once authorized', async () => {
      const invoice = makeAuthorizedInvoice({
        status: 'cancelled',
        nfseNumber: 7,
      });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);
      documentStorage.getSignedUrl.mockResolvedValue({
        url: 'https://storage.example.com/signed.pdf',
        expiresAt: new Date(Date.now() + 3600_000),
        fileName: 'nfse-7.pdf',
        mimeType: 'application/pdf',
      });

      await expect(
        service.getDownloadUrl('inv-1', 'tenant-1', 'pdf'),
      ).resolves.toMatchObject({ fileName: 'nfse-7.pdf' });
    });

    it('throws ServiceUnavailable when storage throws', async () => {
      const invoice = makeAuthorizedInvoice({ nfseNumber: 1 });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);
      documentStorage.getSignedUrl.mockRejectedValue(
        new Error('network error'),
      );

      await expect(
        service.getDownloadUrl('inv-1', 'tenant-1', 'pdf'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // -------------------------------------------------------------------------
  // getXml / getPdf
  // -------------------------------------------------------------------------
  describe('getXml / getPdf', () => {
    it('serves the XML and PDF of a cancelled invoice that was authorized', async () => {
      const invoice = makeAuthorizedInvoice({ status: 'cancelled' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);
      documentStorage.getXml.mockResolvedValue('<xml/>');
      documentStorage.getPdf.mockResolvedValue(Buffer.from('pdf'));

      await expect(service.getXml('inv-1', 'tenant-1')).resolves.toBe('<xml/>');
      await expect(service.getPdf('inv-1', 'tenant-1')).resolves.toEqual(
        Buffer.from('pdf'),
      );
    });

    it('returns 404 for an invoice that was never authorized', async () => {
      const invoice = makeAuthorizedInvoice({
        status: 'cancelled',
        authorizedAt: null,
      });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(service.getXml('inv-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getPdf('inv-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // requestEmail
  // -------------------------------------------------------------------------
  describe('requestEmail', () => {
    it('returns 404 when invoice does not exist for tenant', async () => {
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.requestEmail('inv-noex', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 409 when documents are not ready (status not authorized)', async () => {
      const invoice = makeAuthorizedInvoice({ status: 'queued' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(service.requestEmail('inv-1', 'tenant-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it.each(['cancelling', 'cancelled'] as const)(
      'returns 409 with a cancelled-invoice message for a %s invoice',
      async (status) => {
        const invoice = makeAuthorizedInvoice({ status });
        invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

        const promise = service.requestEmail('inv-1', 'tenant-1');
        await expect(promise).rejects.toThrow(ConflictException);
        await expect(promise).rejects.toThrow(/cancelled/i);
        await expect(promise).rejects.not.toThrow('Documents not ready');
      },
    );

    it('keeps "Documents not ready" for an authorized invoice without documents', async () => {
      const invoice = makeAuthorizedInvoice({ documentsReadyAt: null });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(service.requestEmail('inv-1', 'tenant-1')).rejects.toThrow(
        'Documents not ready',
      );
    });

    it('returns 409 when documentsReadyAt is null even if authorized', async () => {
      const invoice = makeAuthorizedInvoice({ documentsReadyAt: null });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(service.requestEmail('inv-1', 'tenant-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('returns 422 when customer has no email', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: undefined });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(service.requestEmail('inv-1', 'tenant-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('returns 422 when idempotency key format is invalid', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await expect(
        service.requestEmail('inv-1', 'tenant-1', 'invalid key with spaces!'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts valid idempotency key format (alphanumeric with underscore and hyphen)', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      const result = await service.requestEmail(
        'inv-1',
        'tenant-1',
        'valid_key-123',
      );

      expect(result.status).toBe('queued');
      expect(result.emailId).toBe('valid_key-123');
    });

    it('updates email status to queued', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await service.requestEmail('inv-1', 'tenant-1');

      expect(invoiceRepo.updateEmailStatus).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        'queued',
      );
    });

    it('enqueues nfse-email deliver job with correct payload', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await service.requestEmail('inv-1', 'tenant-1');

      expect(capturedQueueAddCalls).toContainEqual([
        'deliver',
        { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnFail: 1000,
        }),
      ]);
    });

    it('uses idempotency key in jobId when provided', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      await service.requestEmail('inv-1', 'tenant-1', 'my-key-123');

      expect(capturedQueueAddCalls).toContainEqual([
        'deliver',
        { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        expect.objectContaining({
          jobId: 'email-resend-inv-1-my-key-123',
        }),
      ]);
    });

    it('returns same emailId when called twice with same idempotency key', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      const r1 = await service.requestEmail('inv-1', 'tenant-1', 'same-key');
      const r2 = await service.requestEmail('inv-1', 'tenant-1', 'same-key');

      expect(r1.emailId).toBe('same-key');
      expect(r2.emailId).toBe('same-key');
    });

    it('returns auto-generated emailId when no idempotency key provided', async () => {
      const invoice = makeAuthorizedInvoice({ customerEmail: 'a@b.com' });
      invoiceRepo.findByIdAndTenantId.mockResolvedValue(invoice);

      const result = await service.requestEmail('inv-1', 'tenant-1');

      expect(result.emailId).toMatch(/^inv_\d+_[a-z0-9]+$/);
      expect(result.status).toBe('queued');
    });
  });
});
