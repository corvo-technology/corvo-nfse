import { Job } from 'bullmq';
import { NfseEmailJobData } from '@/infra/queues/nfse-email-job.types';
import { NfseEmailProcessor } from './nfse-email.processor';
import type { LockPort } from '@/infra/redis/lock.port';
import type { IDocumentStorage } from '@/infra/storage/domain/document-storage';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import {
  PermanentEmailError,
  type MillionSendEmailProvider,
} from '@/infra/external/email/mmsend-email.provider';
import type { Invoice } from '../domain/invoice';
import type { CustomerSnapshot } from '../domain/invoice';

const fakeLock: LockPort = {
  acquire: jest.fn(),
  release: jest.fn(),
  extend: jest.fn(),
  withLock: jest.fn(),
  withRenewingLock: jest.fn(),
};

const fakeDocStorage: Partial<IDocumentStorage> = {
  getPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  getXml: jest.fn().mockResolvedValue('<xml>fake</xml>'),
};

const fakeInvoiceRepo: Partial<IInvoiceRepository> = {
  findByIdAndTenantId: jest.fn(),
  updateEmailStatus: jest.fn(),
};

const fakeEmailProvider: Partial<MillionSendEmailProvider> = {
  send: jest.fn().mockResolvedValue({ id: 'email-123' }),
};

const fakeCompanyRepo = {
  findByIdAndTenantId: jest.fn().mockResolvedValue({
    tradeName: 'Empresa Teste',
    legalName: 'Empresa LTDA',
  }),
};

const fakeConfig: { get: jest.Mock } = {
  get: jest.fn(),
};

function buildInvoice(
  overrides: {
    id?: string;
    tenantId?: string;
    customerEmail?: string;
    customerName?: string;
    nfseNumber?: number;
    accessKey?: string | null;
    amount?: number;
    serviceDescription?: string;
  } = {},
): Invoice {
  const id = overrides.id ?? 'inv-1';
  const tenantId = overrides.tenantId ?? 'tenant-1';
  const customerEmail = overrides.customerEmail;
  const customerName = overrides.customerName ?? 'Cliente';
  const nfseNumber = overrides.nfseNumber ?? 42;
  const accessKey = overrides.accessKey ?? 'access-key-123';
  const amount = overrides.amount ?? 1500;
  const serviceDescription = overrides.serviceDescription ?? 'Consultoria';

  const customerSnapshot: CustomerSnapshot = {
    taxId: '11222333000181',
    name: customerName,
    email: customerEmail,
  };

  return {
    id,
    tenantId,
    companyId: 'company-1',
    status: 'authorized',
    environment: 'live',
    storageEnvironment: 'live',
    documentsReadyAt: new Date(),
    amount,
    nfseNumber,
    accessKey,
    customerSnapshot,
    toSnapshot: () => ({
      id,
      tenantId,
      companyId: 'company-1',
      status: 'authorized',
      amount,
      customerSnapshot,
      serviceSnapshot: {
        code: '010101',
        description: serviceDescription,
        municipalityCode: '3550308',
      },
      accessKey,
      nfseNumber,
    }),
  } as unknown as Invoice;
}

function makeJob(
  overrides: Partial<NfseEmailJobData> = {},
): Job<NfseEmailJobData> {
  return {
    id: 'job-email-1',
    data: {
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      ...overrides,
    },
  } as Job<NfseEmailJobData>;
}

describe('NfseEmailProcessor', () => {
  let processor: NfseEmailProcessor;
  let fakeWorkflow: { emailSent: jest.Mock; emailFailed: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default happy-path mock return values (after clearAllMocks)
    (fakeLock.acquire as jest.Mock).mockResolvedValue({
      key: 'nfse:email:inv-1',
      token: 'tok',
      ttlMs: 30_000,
      release: jest.fn(),
    });
    (fakeDocStorage.getPdf as jest.Mock).mockResolvedValue(
      Buffer.from('%PDF-fake'),
    );
    (fakeDocStorage.getXml as jest.Mock).mockResolvedValue('<xml>fake</xml>');
    (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(null);
    (fakeInvoiceRepo.updateEmailStatus as jest.Mock).mockResolvedValue(
      undefined,
    );
    (fakeEmailProvider.send as jest.Mock).mockResolvedValue({
      id: 'email-123',
    });

    fakeWorkflow = { emailSent: jest.fn(), emailFailed: jest.fn() };
    processor = new NfseEmailProcessor(
      fakeLock,
      fakeDocStorage as IDocumentStorage,
      fakeInvoiceRepo as IInvoiceRepository,
      fakeCompanyRepo as any,
      fakeEmailProvider as MillionSendEmailProvider,
      fakeConfig as any,
      fakeWorkflow as any,
    );
  });

  describe('happy path', () => {
    it('sends email with correct attachments and idempotencyKey = job.id', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob());

      expect(fakeEmailProvider.send).toHaveBeenCalledTimes(1);
      const call = jest.mocked(fakeEmailProvider.send!).mock.calls[0][0];
      expect(call.to).toEqual(['cliente@example.com']);
      expect(call.subject).toContain('nº 42');
      expect(call.html).toContain('Empresa Teste');
      expect(call.text).toContain('Empresa Teste');
      expect(call.idempotencyKey).toBe('job-email-1');
      expect(call.attachments).toHaveLength(2);
      expect(call.attachments![0]).toMatchObject({
        filename: 'nfse-42.pdf',
        contentType: 'application/pdf',
      });
      expect(call.attachments![1]).toMatchObject({
        filename: 'nfse-42.xml',
        contentType: 'application/xml',
      });
    });

    it('sends to the edited address when the job carries toEmail', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob({ toEmail: 'novo@example.com' }));

      const call = jest.mocked(fakeEmailProvider.send!).mock.calls[0][0];
      expect(call.to).toEqual(['novo@example.com']);
    });

    it('updates email status to sent on success', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob());

      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledTimes(1);
      const [invoiceId, tenantId, status, sentAt] = (
        fakeInvoiceRepo.updateEmailStatus as jest.Mock
      ).mock.calls[0];
      expect(invoiceId).toBe('inv-1');
      expect(tenantId).toBe('tenant-1');
      expect(status).toBe('sent');
      expect(sentAt).toBeInstanceOf(Date);
    });

    it('emits the email_sent webhook after marking the email as sent', async () => {
      const invoice = buildInvoice({ customerEmail: 'cliente@example.com' });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        invoice,
      );
      await processor.process(makeJob());

      expect(fakeWorkflow.emailSent).toHaveBeenCalledTimes(1);
      const [emitted, sentAt] = fakeWorkflow.emailSent.mock.calls[0];
      expect(emitted).toBe(invoice);
      expect(sentAt).toBe(
        (
          fakeInvoiceRepo.updateEmailStatus as jest.Mock<
            Promise<void>,
            [string, string, string, Date]
          >
        ).mock.calls[0][3],
      );
    });

    it('fetches PDF and XML from document storage', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob());

      expect(fakeDocStorage.getPdf).toHaveBeenCalledWith(
        'tenant-1',
        'inv-1',
        'live',
      );
      expect(fakeDocStorage.getXml).toHaveBeenCalledWith(
        'tenant-1',
        'inv-1',
        'live',
      );
    });
  });

  describe('cancelled invoices — no e-mail', () => {
    it.each(['cancelling', 'cancelled'] as const)(
      'returns without throwing or touching e-mail status for a %s invoice',
      async (status) => {
        const invoice = buildInvoice({ customerEmail: 'cliente@example.com' });
        Object.assign(invoice, { status });
        (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
          invoice,
        );
        await expect(processor.process(makeJob())).resolves.toBeUndefined();
        expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
        expect(fakeDocStorage.getPdf).not.toHaveBeenCalled();
        expect(fakeDocStorage.getXml).not.toHaveBeenCalled();
        expect(fakeEmailProvider.send).not.toHaveBeenCalled();
      },
    );

    it('still throws for an authorized invoice without documents', async () => {
      const invoice = buildInvoice({ customerEmail: 'cliente@example.com' });
      Object.assign(invoice, { documentsReadyAt: null });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        invoice,
      );
      await expect(processor.process(makeJob())).rejects.toThrow(
        'Invoice documents are not ready',
      );
    });
  });

  describe('no customer email — silent skip', () => {
    it('marks invoice as failed when customer has no email', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: undefined }),
      );
      await processor.process(makeJob());

      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        'failed',
      );
      expect(fakeEmailProvider.send).not.toHaveBeenCalled();
    });

    it('does not call email provider when customer email is missing', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: undefined }),
      );
      await processor.process(makeJob());

      expect(fakeEmailProvider.send).not.toHaveBeenCalled();
    });
  });

  describe('anonymous customer — no customer snapshot', () => {
    it('completes without error and marks the email as failed', async () => {
      const base = buildInvoice({ customerEmail: 'cliente@example.com' });
      const invoice = {
        ...base,
        customerSnapshot: null,
        toSnapshot: () => ({
          ...base.toSnapshot(),
          customerSnapshot: null,
        }),
      } as unknown as Invoice;
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        invoice,
      );

      await expect(processor.process(makeJob())).resolves.toBeUndefined();

      expect(fakeEmailProvider.send).not.toHaveBeenCalled();
      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        'failed',
      );
    });
  });

  describe('permanent provider refusal', () => {
    it('marks the email as failed right away and finishes the job instead of retrying', async () => {
      const invoice = buildInvoice({ customerEmail: 'joao@example.com' });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        invoice,
      );
      (fakeEmailProvider.send as jest.Mock).mockRejectedValue(
        new PermanentEmailError('example.com accepts no mail'),
      );

      await expect(processor.process(makeJob())).resolves.toBeUndefined();
      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledWith(
        'inv-1',
        expect.any(String),
        'failed',
      );
      expect(fakeWorkflow.emailFailed).toHaveBeenCalledWith(invoice);
    });
  });

  describe('intermediate failure — no DB write', () => {
    it('does not update email status on intermediate failure', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      (fakeDocStorage.getPdf as jest.Mock).mockRejectedValue(
        new Error('S3 down'),
      );

      await expect(processor.process(makeJob())).rejects.toThrow('S3 down');
      expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
    });

    it('does not update email status when email provider fails', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      (fakeEmailProvider.send as jest.Mock).mockRejectedValue(
        new Error('SMTP error'),
      );

      await expect(processor.process(makeJob())).rejects.toThrow('SMTP error');
      expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
    });
  });

  describe('final failure — failed status written', () => {
    it('calls updateEmailStatus with failed when all retries exhausted', async () => {
      const failedJob = {
        id: 'job-email-1',
        data: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as Job<NfseEmailJobData>;

      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      await processor.onFailed(failedJob);

      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledTimes(1);
      const [invoiceId, tenantId, status] = (
        fakeInvoiceRepo.updateEmailStatus as jest.Mock
      ).mock.calls[0];
      expect(invoiceId).toBe('inv-1');
      expect(tenantId).toBe('tenant-1');
      expect(status).toBe('failed');
    });

    it('does not call updateEmailStatus when attemptsMade < maxAttempts', async () => {
      const retryJob = {
        id: 'job-email-1',
        data: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as Job<NfseEmailJobData>;

      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      await processor.onFailed(retryJob);

      expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
    });

    it('defaults to 1 attempt when opts.attempts is undefined', async () => {
      const job = {
        id: 'job-email-1',
        data: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        attemptsMade: 1,
        opts: {},
      } as Job<NfseEmailJobData>;

      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      await processor.onFailed(job);

      expect(fakeInvoiceRepo.updateEmailStatus).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        'failed',
      );
    });
  });

  describe('lock', () => {
    it('acquires lock with correct key and ttl', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob());

      expect(fakeLock.acquire).toHaveBeenCalledWith('nfse:email:inv-1', {
        ttlMs: 30_000,
      });
    });

    it('skips when lock cannot be acquired', async () => {
      (fakeLock.acquire as jest.Mock).mockResolvedValue(null);
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );
      await processor.process(makeJob());

      expect(fakeInvoiceRepo.findByIdAndTenantId).not.toHaveBeenCalled();
      expect(fakeEmailProvider.send).not.toHaveBeenCalled();
    });

    it('releases lock on success', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ customerEmail: 'cliente@example.com' }),
      );

      await processor.process(makeJob());

      expect(fakeLock.release).toHaveBeenCalled();
    });

    it('releases lock on failure', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockRejectedValue(
        new Error('DB down'),
      );

      await expect(processor.process(makeJob())).rejects.toThrow('DB down');
      expect(fakeLock.release).toHaveBeenCalled();
    });
  });

  describe('invoice not found', () => {
    it('returns early when invoice is not found', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        null,
      );
      await processor.process(makeJob());

      expect(fakeEmailProvider.send).not.toHaveBeenCalled();
      expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
    });
  });
});
