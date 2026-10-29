import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { InvoiceController } from './invoice.controller';
import { REQUIRED_TENANT_PERMISSION } from '@/modules/auth/require-permission.decorator';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';

describe('InvoiceController', () => {
  const invoiceService = {
    emit: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    getXml: jest.fn(),
    getPdf: jest.fn(),
    getEvents: jest.fn(),
    getDownloadUrl: jest.fn(),
    requestEmail: jest.fn(),
    cancel: jest.fn(),
  };

  const mockRes = { setHeader: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  describe('POST :id/cancel', () => {
    const req = {
      authContext: { activeTenantId: tenantId },
    } as never;

    it.each([
      ['cancelled', 200],
      ['cancelling', 202],
    ] as const)('answers %s with HTTP %i', async (status, code) => {
      const invoice = { status };
      invoiceService.cancel.mockResolvedValue(invoice);
      const res = { status: jest.fn() };
      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );

      await expect(
        controller.cancel(invoiceId, { reason: 'other' }, req, res as never),
      ).resolves.toBe(invoice);

      expect(res.status).toHaveBeenCalledWith(code);
      expect(invoiceService.cancel).toHaveBeenCalledWith(
        invoiceId,
        tenantId,
        'test',
        { reason: 'other' },
      );
    });
  });

  describe('POST :id/download-url', () => {
    it('returns 200 with signed URL and sets Cache-Control: no-store', async () => {
      const expiresAt = new Date('2026-10-10T00:00:00.000Z');
      invoiceService.getDownloadUrl.mockResolvedValue({
        url: 'https://storage.example.com/signed',
        expiresAt,
        fileName: 'nfse-123.pdf',
        mimeType: 'application/pdf',
      });

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );
      const result = await controller.getDownloadUrl(
        invoiceId,
        { format: 'pdf' },
        { authContext: { activeTenantId: tenantId } } as never,
        mockRes as never,
      );

      expect(invoiceService.getDownloadUrl).toHaveBeenCalledWith(
        invoiceId,
        tenantId,
        'pdf',
        'test',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );
      expect(result).toEqual({
        data: {
          downloadUrl: 'https://storage.example.com/signed',
          expiresAt: '2026-10-10T00:00:00.000Z',
          fileName: 'nfse-123.pdf',
          mimeType: 'application/pdf',
        },
      });
    });

    it('returns 404 when invoice is not authorized', async () => {
      invoiceService.getDownloadUrl.mockRejectedValue(
        new NotFoundException('PDF not available for non-authorized invoice'),
      );

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );

      await expect(
        controller.getDownloadUrl(
          invoiceId,
          { format: 'pdf' },
          { authContext: { activeTenantId: tenantId } } as never,
          mockRes as never,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 503 when storage is unavailable', async () => {
      invoiceService.getDownloadUrl.mockRejectedValue(
        new ServiceUnavailableException('Document storage is unavailable'),
      );

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );

      await expect(
        controller.getDownloadUrl(
          invoiceId,
          { format: 'xml' },
          { authContext: { activeTenantId: tenantId } } as never,
          mockRes as never,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('POST :id/email', () => {
    it('returns 202 with emailId and status', async () => {
      invoiceService.requestEmail.mockResolvedValue({
        emailId: 'inv_123456',
        status: 'queued',
      });

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );
      const result = await controller.requestEmail(
        invoiceId,
        { authContext: { activeTenantId: tenantId } } as never,
        undefined,
      );

      expect(invoiceService.requestEmail).toHaveBeenCalledWith(
        invoiceId,
        tenantId,
        undefined,
        'test',
      );
      expect(result).toEqual({
        data: {
          emailId: 'inv_123456',
          status: 'queued',
        },
      });
    });

    it('returns 404 when invoice is not authorized', async () => {
      invoiceService.requestEmail.mockRejectedValue(
        new NotFoundException(
          'Email cannot be sent for non-authorized invoice',
        ),
      );

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );

      await expect(
        controller.requestEmail(
          invoiceId,
          { authContext: { activeTenantId: tenantId } } as never,
          undefined,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when customer has no email', async () => {
      invoiceService.requestEmail.mockRejectedValue(
        new NotFoundException('Customer has no email address on file'),
      );

      const controller = new InvoiceController(
        invoiceService as never,
        {} as never,
        {} as never,
      );

      await expect(
        controller.requestEmail(
          invoiceId,
          { authContext: { activeTenantId: tenantId } } as never,
          undefined,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('InvoiceController POST batches', () => {
  const batchService = { emitBatch: jest.fn() };
  const authContext = {
    activeTenantId: 'tenant-1',
    executionEnvironment: 'test',
  };
  const controller = new InvoiceController(
    {} as never,
    {} as never,
    batchService as never,
  );

  it('delegates to InvoiceBatchService with the items, tenant and auth context', async () => {
    const result = { total: 1, accepted: 1, rejected: 0, results: [] };
    batchService.emitBatch.mockResolvedValue(result);
    const invoices = [{ amount: 1 }];

    await expect(
      controller.emitBatch({ invoices }, { authContext } as never),
    ).resolves.toBe(result);

    expect(batchService.emitBatch).toHaveBeenCalledWith(
      invoices,
      'tenant-1',
      authContext,
    );
  });

  it('is POST /invoices/batches answering 202 under nfse.invoices.issue with a 10/min throttle', () => {
    const handler = InvoiceController.prototype.emitBatch;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('batches');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);
    expect(Reflect.getMetadata(REQUIRED_TENANT_PERMISSION, handler)).toBe(
      'nfse.invoices.issue',
    );
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
