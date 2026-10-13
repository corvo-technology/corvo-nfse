import { Job } from 'bullmq';
import { MillionSendEmailProvider } from '@/infra/external/email/mmsend-email.provider';
import { MillionSendTemplateClient } from '@/infra/external/email/email-template.client';
import { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import { IWebhookConfigRepository } from '@/modules/webhooks-config/domain/webhook-config.repository';
import { EmailProcessor } from './email.processor';
import type { EmailJobData } from './email-job.types';

describe('EmailProcessor', () => {
  const mockProvider = {
    send: jest.fn().mockResolvedValue({ id: 'email_123' }),
  } as unknown as jest.Mocked<MillionSendEmailProvider>;

  const mockTemplates = {
    render: jest
      .fn()
      .mockResolvedValue({ subject: 'Assunto', html: '<p>Corpo</p>' }),
  } as unknown as jest.Mocked<MillionSendTemplateClient>;

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
    mockTemplates,
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

  describe('template jobs', () => {
    it('renders the MillionSend template before sending', async () => {
      mockProvider.send.mockResolvedValue({ id: 'email_1' });
      const job = {
        data: {
          emailId: 'welcome_001',
          to: 'user@example.com',
          kind: 'welcome',
          template: {
            alias: 'welcome',
            variables: { user_name: 'Pedro', dashboard_url: 'https://x' },
          },
        },
        id: 'job_3',
      } as unknown as Job<EmailJobData>;

      await processor.process(job);

      expect(mockTemplates.render).toHaveBeenCalledWith({
        alias: 'welcome',
        variables: { user_name: 'Pedro', dashboard_url: 'https://x' },
      });
      expect(mockProvider.send).toHaveBeenCalledWith({
        to: ['user@example.com'],
        subject: 'Assunto',
        html: '<p>Corpo</p>',
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
          template: {
            alias: 'otp-code',
            variables: { code: '123456', expires_in_minutes: '5' },
          },
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
