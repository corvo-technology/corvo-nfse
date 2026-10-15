import { Job } from 'bullmq';
import type { LockPort } from '@/infra/redis/lock.port';
import type { IDocumentStorage } from '@/infra/storage/domain/document-storage';
import type { IInvoiceRepository } from '../domain/invoice.repository';
import type { BullmqQueueService } from '@/infra/redis/bullmq-queue.service';
import type { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import type { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import type { Invoice } from '../domain/invoice';
import { NfseDocPrepProcessor } from './nfse-doc-prep.processor';
import type { NfseDocPrepJobData } from '@/infra/queues/nfse-doc-prep-job.types';

jest.mock('open-nfse', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...jest.requireActual('open-nfse'),
    parseNfseXml: jest.fn(),
    gerarDanfse: jest.fn(),
  };
});

import { Ambiente, parseNfseXml, gerarDanfse } from 'open-nfse';

const fakeLock: LockPort = {
  acquire: jest.fn(),
  release: jest.fn(),
  extend: jest.fn(),
  withLock: jest.fn(),
  withRenewingLock: jest.fn(),
};

const fakeDocStorage: Partial<IDocumentStorage> = {
  exists: jest.fn(),
  getXml: jest.fn(),
  saveXml: jest.fn(),
  savePdf: jest.fn(),
};

const fakeInvoiceRepo: Partial<IInvoiceRepository> = {
  findByIdAndTenantId: jest.fn(),
  markDocumentsReady: jest.fn(),
  updateEmailStatus: jest.fn(),
};

const fakeQueueService: Partial<BullmqQueueService> = {
  add: jest.fn(),
};

const fakeWebhookConfigRepo: Partial<IWebhookConfigRepository> = {
  findByTenantIdAndEvent: jest.fn().mockResolvedValue([]),
};

const fakeOutboxService: Partial<WebhookOutboxService> = {
  enqueue: jest.fn(),
};

function buildInvoice(
  overrides: Partial<{
    id: string;
    tenantId: string;
    companyId: string;
    status: string;
    accessKey: string | null;
    nfseNumber: number | null;
    documentsReadyAt: Date | null;
    emailSnapshot: { send?: boolean };
    customerSnapshot: { email?: string };
  }> = {},
): Invoice {
  return {
    environment: 'live',
    storageEnvironment: 'live',
    toSnapshot: () => ({}),
    id: overrides.id ?? 'inv-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    companyId: overrides.companyId ?? 'company-1',
    status: (overrides.status ?? 'authorized') as Invoice['status'],
    accessKey:
      overrides.accessKey ?? '12345678901234567890123456789012345678901234',
    nfseNumber: overrides.nfseNumber ?? 42,
    documentsReadyAt: overrides.documentsReadyAt ?? null,
    emailSnapshot: overrides.emailSnapshot,
    customerSnapshot: {
      taxId: '11222333000181',
      name: 'Cliente',
      email: 'cliente@example.com',
      ...overrides.customerSnapshot,
    },
    serviceSnapshot: {
      code: '010101',
      description: 'Consultoria',
      municipalityCode: '3550308',
    },
    taxSnapshot: {},
    amount: 1500,
    currency: 'BRL',
    competenceDate: new Date(),
    dpsId: 'dps-1',
    dpsSeries: '1',
    dpsNumber: 1,
    fiscalProvider: 'open-nfse',
    fiscalSchemaVersion: '1.00',
    issuedAt: new Date(),
    authorizedAt: new Date(),
    lastErrorCode: null,
    lastErrorMessage: null,
    lastErrorProvider: null,
    lastEmailStatus: null,
    lastEmailSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Invoice;
}

function makeJob(
  overrides: Partial<NfseDocPrepJobData> = {},
): Job<NfseDocPrepJobData> {
  return {
    id: 'job-doc-prep-1',
    data: {
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      ...overrides,
    },
  } as unknown as Job<NfseDocPrepJobData>;
}

describe('NfseDocPrepProcessor', () => {
  let processor: NfseDocPrepProcessor;

  beforeEach(() => {
    jest.resetAllMocks();

    (fakeLock.acquire as jest.Mock).mockResolvedValue({
      key: 'nfse:doc-prep:inv-1',
      token: 'tok',
      ttlMs: 60_000,
      release: jest.fn(),
    });
    (fakeLock.release as jest.Mock).mockResolvedValue(true);
    (fakeDocStorage.exists as jest.Mock).mockResolvedValue(false);
    (fakeDocStorage.getXml as jest.Mock).mockResolvedValue('<xml>fake</xml>');
    (fakeDocStorage.savePdf as jest.Mock).mockResolvedValue('pdf-key');
    (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(null);
    (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(false);
    (fakeQueueService.add as jest.Mock).mockResolvedValue({
      id: 'email-job-1',
    });
    (
      fakeWebhookConfigRepo.findByTenantIdAndEvent as jest.Mock
    ).mockResolvedValue([]);
    (fakeOutboxService.enqueue as jest.Mock).mockResolvedValue(undefined);

    (parseNfseXml as jest.Mock).mockReturnValue({
      infNFSe: {
        DPS: {
          infDPS: {
            tpAmb: '1',
          },
        },
      },
    });
    (gerarDanfse as jest.Mock).mockResolvedValue(Buffer.from('%PDF-fake'));

    processor = new NfseDocPrepProcessor(
      fakeLock,
      fakeDocStorage as IDocumentStorage,
      fakeInvoiceRepo as IInvoiceRepository,
      fakeQueueService as BullmqQueueService,
      fakeWebhookConfigRepo as IWebhookConfigRepository,
      fakeOutboxService as WebhookOutboxService,
    );
  });

  describe('happy path — generates PDF, marks ready, emits webhook and email', () => {
    it('generates PDF from XML and saves it', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      (fakeDocStorage.exists as jest.Mock).mockResolvedValue(false);

      await processor.process(makeJob());

      expect(parseNfseXml).toHaveBeenCalledWith('<xml>fake</xml>');
      expect(gerarDanfse).toHaveBeenCalledWith(
        expect.objectContaining({ infNFSe: expect.any(Object) }),
        expect.objectContaining({ ambiente: expect.any(String) }),
      );
      expect(fakeDocStorage.savePdf).toHaveBeenCalledWith(
        'tenant-1',
        'inv-1',
        Buffer.from('%PDF-fake'),
        'live',
      );
    });

    it('marks documents ready with first-write-wins semantics', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(true);

      await processor.process(makeJob());

      expect(fakeInvoiceRepo.markDocumentsReady).toHaveBeenCalledTimes(1);
      expect(fakeInvoiceRepo.markDocumentsReady).toHaveBeenCalledWith(
        'inv-1',
        'tenant-1',
        expect.any(Date),
      );
    });

    it('emits nfse.invoice.documents_ready webhook when markDocumentsReady returns true', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ emailSnapshot: { send: true } }),
      );
      (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(true);
      (
        fakeWebhookConfigRepo.findByTenantIdAndEvent as jest.Mock
      ).mockResolvedValue([
        {
          id: 'webhook-1',
          tenantId: 'tenant-1',
          eventType: 'nfse.invoice.documents_ready',
          active: true,
          url: 'https://example.com/hook',
          secret: 'secret',
        },
      ]);

      await processor.process(makeJob());

      expect(fakeOutboxService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'nfse.invoice.documents_ready',
          environment: 'live',
          url: 'https://example.com/hook',
          payload: expect.objectContaining({
            type: 'nfse.invoice.documents_ready',
            data: expect.objectContaining({
              invoiceId: 'inv-1',
              status: 'authorized',
              documentsStatus: 'ready',
              emailStatus: null,
              stage: 'documents_ready',
            }),
          }),
        }),
      );
    });

    it('enqueues nfse-email deliver job when emailSnapshot.send is true', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ emailSnapshot: { send: true } }),
      );
      (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(true);

      await processor.process(makeJob());

      expect(fakeQueueService.add).toHaveBeenCalledWith(
        'nfse-email',
        'deliver',
        { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        expect.objectContaining({
          idempotencyKey: 'email-auto-inv-1',
          attempts: 3,
          backoffMs: 5_000,
          removeOnComplete: false,
          removeOnFail: 1000,
        }),
      );
    });

    it('skips PDF generation when pdf already exists', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      (fakeDocStorage.exists as jest.Mock).mockResolvedValue(true);

      await processor.process(makeJob());

      expect(fakeDocStorage.getXml).not.toHaveBeenCalled();
      expect(gerarDanfse).not.toHaveBeenCalled();
      expect(fakeDocStorage.savePdf).not.toHaveBeenCalled();
    });

    it('releases lock on success', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob());

      expect(fakeLock.release).toHaveBeenCalled();
    });
  });

  describe('idempotency — skips work when documents already ready', () => {
    it('returns early when documentsReadyAt is already set', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ documentsReadyAt: new Date() }),
      );

      await processor.process(makeJob());

      expect(fakeDocStorage.exists).not.toHaveBeenCalled();
      expect(fakeInvoiceRepo.markDocumentsReady).not.toHaveBeenCalled();
      expect(fakeQueueService.add).not.toHaveBeenCalled();
    });

    it('skips post-actions when markDocumentsReady returns false (another worker won)', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );
      (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(
        false,
      );

      await processor.process(makeJob());

      expect(fakeOutboxService.enqueue).not.toHaveBeenCalled();
      expect(fakeQueueService.add).not.toHaveBeenCalled();
    });
  });

  describe('guard checks', () => {
    it('skips when invoice is not found', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        null,
      );

      await processor.process(makeJob());

      expect(fakeDocStorage.exists).not.toHaveBeenCalled();
      expect(fakeInvoiceRepo.markDocumentsReady).not.toHaveBeenCalled();
    });

    it('returns early when invoice status is not authorized', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice({ status: 'pending' }),
      );

      await expect(processor.process(makeJob())).resolves.toBeUndefined();
      expect(fakeDocStorage.exists).not.toHaveBeenCalled();
    });

    it.each(['queued', 'rejected'])(
      'still skips a %s invoice',
      async (status) => {
        (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
          buildInvoice({ status }),
        );

        await processor.process(makeJob());

        expect(fakeDocStorage.exists).not.toHaveBeenCalled();
        expect(fakeInvoiceRepo.markDocumentsReady).not.toHaveBeenCalled();
      },
    );
  });

  describe('invoices cancelled before documents were prepared', () => {
    it.each(['cancelling', 'cancelled'])(
      'generates the PDF and marks documents ready for a %s invoice without enqueuing email',
      async (status) => {
        (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
          buildInvoice({
            status,
            emailSnapshot: { send: true },
          }),
        );
        (fakeInvoiceRepo.markDocumentsReady as jest.Mock).mockResolvedValue(
          true,
        );

        await processor.process(makeJob());

        expect(fakeDocStorage.savePdf).toHaveBeenCalledWith(
          'tenant-1',
          'inv-1',
          Buffer.from('%PDF-fake'),
          'live',
        );
        expect(fakeInvoiceRepo.markDocumentsReady).toHaveBeenCalledTimes(1);
        expect(fakeQueueService.add).not.toHaveBeenCalled();
        expect(fakeInvoiceRepo.updateEmailStatus).not.toHaveBeenCalled();
      },
    );
  });

  describe('lock', () => {
    it('acquires lock with correct key and TTL', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob({ invoiceId: 'inv-123' }));

      expect(fakeLock.acquire).toHaveBeenCalledWith('nfse:doc-prep:inv-123', {
        ttlMs: 60_000,
      });
    });

    it('skips without error when lock cannot be acquired', async () => {
      (fakeLock.acquire as jest.Mock).mockResolvedValue(null);
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob());

      expect(fakeInvoiceRepo.findByIdAndTenantId).not.toHaveBeenCalled();
      expect(fakeInvoiceRepo.markDocumentsReady).not.toHaveBeenCalled();
    });

    it('releases lock even when process throws', async () => {
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(processor.process(makeJob())).rejects.toThrow('DB error');
      expect(fakeLock.release).toHaveBeenCalled();
    });
  });

  describe('ambiente mapping from tpAmb', () => {
    it('maps tpAmb "1" to Producao', async () => {
      (parseNfseXml as jest.Mock).mockReturnValue({
        infNFSe: { DPS: { infDPS: { tpAmb: '1' } } },
      });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob());

      expect(gerarDanfse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          ambiente: Ambiente.Producao,
          urlConsultaPublica: 'https://adn.nfse.gov.br/contribuintes/consulta',
        }),
      );
    });

    it('maps tpAmb "2" to ProducaoRestrita', async () => {
      (parseNfseXml as jest.Mock).mockReturnValue({
        infNFSe: { DPS: { infDPS: { tpAmb: '2' } } },
      });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob());

      expect(gerarDanfse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          ambiente: Ambiente.ProducaoRestrita,
          urlConsultaPublica:
            'https://adn.producaorestrita.nfse.gov.br/contribuintes/consulta',
        }),
      );
    });

    it('falls back to Producao when tpAmb is undefined', async () => {
      (parseNfseXml as jest.Mock).mockReturnValue({
        infNFSe: { DPS: { infDPS: { tpAmb: undefined } } },
      });
      (fakeInvoiceRepo.findByIdAndTenantId as jest.Mock).mockResolvedValue(
        buildInvoice(),
      );

      await processor.process(makeJob());

      expect(gerarDanfse).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          ambiente: Ambiente.Producao,
        }),
      );
    });
  });
});
