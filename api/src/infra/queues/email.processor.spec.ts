import { Job } from 'bullmq';
import { MillionSendEmailProvider } from '@/infra/external/email/mmsend-email.provider';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { EmailProcessor, maskEmail } from './email.processor';
import type { EmailJobData } from './email-job.types';

describe('EmailProcessor', () => {
  const mockProvider = {
    send: jest.fn().mockResolvedValue({ id: 'email_123' }),
  } as unknown as jest.Mocked<MillionSendEmailProvider>;

  const mockOutbox = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<WebhookOutboxService>;

  const mockConfigRepo = {
    findByTenantIdAndEvent: jest.fn(),
  } as unknown as jest.Mocked<IWebhookConfigRepository>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const processor = new EmailProcessor(
    mockProvider,
    mockOutbox,
    mockConfigRepo,
  );

  describe('invoice failure → webhook outbox', () => {
    it('enqueues webhook when invoice fails after retries', async () => {
      mockProvider.send.mockRejectedValue(new Error('API error'));
      mockConfigRepo.findByTenantIdAndEvent.mockResolvedValueOnce([
        {
          id: 'cfg_1',
          tenantId: 'tenant_1',
          events: ['email.failed'],
          active: true,
          url: 'https://example.com/webhook',
          secret: 'secret',
          environment: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const job = {
        data: {
          emailId: 'inv_001',
          to: 'client@example.com',
          subject: 'Nota Fiscal',
          html: '<p>Nota</p>',
          kind: 'invoice',
          customerName: 'João',
          customerTaxId: '12345678909',
          serviceDescription: 'Dev',
          amount: '250.00',
          nfseNumber: 1234,
          accessKey: 'key123',
          tenantId: 'tenant_1',
          apiKeyEnvironment: 'live',
        },
        attemptsMade: 3,
        id: 'job_1',
      } as Job<EmailJobData>;

      await processor.failed(job);

      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_1',
          eventType: 'email.failed',
        }),
      );
    });
  });

  describe('rendered email jobs', () => {
    it('sends the html and plain text it was given', async () => {
      mockProvider.send.mockResolvedValue({ id: 'email_1' });
      const job = {
        data: {
          emailId: 'welcome_001',
          to: 'user@example.com',
          kind: 'welcome',
          email: { subject: 'Assunto', html: '<p>Corpo</p>', text: 'Corpo' },
        },
        id: 'job_3',
      } as unknown as Job<EmailJobData>;

      await processor.process(job);

      expect(mockProvider.send).toHaveBeenCalledWith({
        to: ['user@example.com'],
        subject: 'Assunto',
        html: '<p>Corpo</p>',
        text: 'Corpo',
      });
    });
  });

  describe('otp failure → silent discard', () => {
    it('does NOT enqueue webhook for otp failure', async () => {
      mockProvider.send.mockRejectedValue(new Error('API error'));
      mockConfigRepo.findByTenantIdAndEvent.mockResolvedValueOnce([]);

      const job = {
        data: {
          emailId: 'otp_001',
          to: 'user@example.com',
          email: { subject: 'Código', html: '<p>123456</p>', text: '123456' },
          kind: 'otp',
          code: '123456',
          expiresInMinutes: 5,
          productKey: 'corvo',
        },
        attemptsMade: 3,
        id: 'job_2',
      } as unknown as Job<EmailJobData>;

      await processor.failed(job);

      expect(mockOutbox.enqueue).not.toHaveBeenCalled();
    });
  });
});

describe('maskEmail', () => {
  it('keeps only the first letter and the domain', () => {
    expect(maskEmail('fulana@gmail.com')).toBe('f***@gmail.com');
    expect(maskEmail('sem-arroba')).toBe('***');
  });
});
