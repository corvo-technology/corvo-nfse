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
});
