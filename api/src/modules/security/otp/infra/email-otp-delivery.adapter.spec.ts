import { EmailOtpDeliveryAdapter } from './email-otp-delivery.adapter';
import type { EmailService } from '@/modules/email/application/email.service';

describe('EmailOtpDeliveryAdapter', () => {
  let adapter: EmailOtpDeliveryAdapter;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    emailService = {
      enqueueOtp: jest.fn().mockResolvedValue(undefined),
      enqueueWelcome: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailService>;
    adapter = new EmailOtpDeliveryAdapter(emailService);
  });

  it('has channel email', () => {
    expect(adapter.channel).toBe('email');
  });

  it('enqueues with correct params for corvo', async () => {
    const expiresAt = Date.now() + 300_000; // 5 minutes

    await adapter.send({
      target: 'user@example.com',
      code: '654321',
      purpose: 'email_verification',
      expiresAt,
    });

    expect(emailService.enqueueOtp).toHaveBeenCalledWith({
      productKey: 'corvo',
      to: 'user@example.com',
      code: '654321',
      expiresInMinutes: 5,
    });
  });

  it('enqueues with correct params for divella', async () => {
    const expiresAt = Date.now() + 600_000; // 10 minutes

    await adapter.send({
      target: 'admin@divella.com',
      code: '111222',
      purpose: 'phone_verification',
      expiresAt,
      productKey: 'divella',
    });

    expect(emailService.enqueueOtp).toHaveBeenCalledWith({
      productKey: 'divella',
      to: 'admin@divella.com',
      code: '111222',
      expiresInMinutes: 10,
    });
  });

  it('propagates queue errors', async () => {
    emailService.enqueueOtp.mockRejectedValueOnce(
      new Error('Queue unavailable'),
    );

    await expect(
      adapter.send({
        target: 'user@example.com',
        code: '123456',
        purpose: 'email_verification',
        expiresAt: Date.now() + 300_000,
      }),
    ).rejects.toThrow('Queue unavailable');
  });
});
