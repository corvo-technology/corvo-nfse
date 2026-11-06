import type { ConfigService } from '@nestjs/config';
import { QueuePort } from '@/infra/redis/queue.port';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const mockQueue = {
    add: jest
      .fn()
      .mockResolvedValue({ id: 'job_1', queueName: 'email', jobName: 'otp' }),
  } as unknown as jest.Mocked<QueuePort>;

  const service = new EmailService(mockQueue, {
    get: jest.fn(),
  } as unknown as ConfigService);

  describe('enqueueOtp', () => {
    it('enqueues otp job with correct data', async () => {
      await service.enqueueOtp({
        to: 'user@example.com',
        code: '123456',
        expiresInMinutes: 5,
        productKey: 'corvo',
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'email',
        'otp',
        expect.objectContaining({
          kind: 'otp',
          to: 'user@example.com',
          code: '123456',
          template: {
            alias: 'otp-code',
            variables: { code: '123456', expires_in_minutes: '5' },
          },
        }),
        expect.any(Object),
      );
    });
  });

  describe('enqueueWelcome', () => {
    it('enqueues welcome job with default APP_URL', async () => {
      await service.enqueueWelcome({ to: 'new@example.com', name: 'Pedro' });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'email',
        'welcome',
        expect.objectContaining({
          kind: 'welcome',
          to: 'new@example.com',
          template: {
            alias: 'welcome',
            variables: {
              user_name: 'Pedro',
              dashboard_url: 'https://corvo.tech/app',
            },
          },
        }),
        expect.any(Object),
      );
    });
  });

  describe('enqueueCreditsLow', () => {
    it('enqueues the credits-low template with the billing link', async () => {
      const withUrl = new EmailService(mockQueue, {
        get: jest.fn().mockReturnValue('https://corvo.tech/app'),
      } as unknown as ConfigService);

      await withUrl.enqueueCreditsLow({
        to: 'admin@example.com',
        planName: 'Gratuito',
        remaining: 3,
        total: 15,
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'email',
        'credits-low',
        expect.objectContaining({
          kind: 'credits-low',
          to: 'admin@example.com',
          template: {
            alias: 'credits-low',
            variables: {
              plan_name: 'Gratuito',
              remaining: '3',
              total: '15',
              billing_url: 'https://corvo.tech/app/billing',
            },
          },
        }),
        expect.any(Object),
      );
    });
  });
  describe('schedule notices', () => {
    const withUrl = () =>
      new EmailService(mockQueue, {
        get: jest.fn().mockReturnValue('https://corvo.tech/app'),
      } as unknown as ConfigService);

    it('enqueues the retry notice with the schedules, the reason and both links', async () => {
      await withUrl().enqueueScheduleRetry({
        to: 'admin@example.com',
        count: 2,
        schedules: 'Acme Ltda (R$ 150,00); Beta ME (R$ 90,00)',
        reason: 'não há notas disponíveis na sua conta',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'email',
        'schedule-retry',
        expect.objectContaining({
          kind: 'schedule-retry',
          to: 'admin@example.com',
          template: {
            alias: 'schedule-retry',
            variables: {
              count: '2',
              schedules: 'Acme Ltda (R$ 150,00); Beta ME (R$ 90,00)',
              reason: 'não há notas disponíveis na sua conta',
              billing_url: 'https://corvo.tech/app/billing',
              schedules_url: 'https://corvo.tech/app/schedules',
            },
          },
        }),
        expect.any(Object),
      );
    });

    it('enqueues the pause notice for one schedule', async () => {
      await withUrl().enqueueSchedulePaused({
        to: 'admin@example.com',
        companyName: 'Acme Ltda',
        amount: 'R$ 150,00',
        reason: 'não há notas disponíveis na sua conta',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'email',
        'schedule-paused',
        expect.objectContaining({
          kind: 'schedule-paused',
          template: {
            alias: 'schedule-paused',
            variables: {
              company_name: 'Acme Ltda',
              amount: 'R$ 150,00',
              reason: 'não há notas disponíveis na sua conta',
              schedules_url: 'https://corvo.tech/app/schedules',
            },
          },
        }),
        expect.any(Object),
      );
    });
  });
});
