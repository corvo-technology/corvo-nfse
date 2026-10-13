import { OtpDeliveryGateway } from './otp-delivery.gateway';
import { OtpDeliveryUnavailableError } from '../domain/otp-errors';

describe('OtpDeliveryGateway', () => {
  it('registers and unregisters channel adapters without exposing connectors to the OTP core', async () => {
    const gateway = new OtpDeliveryGateway();
    const adapter = {
      channel: 'email' as const,
      send: jest.fn().mockResolvedValue(undefined),
    };

    expect(gateway.supports('email')).toBe(false);
    gateway.register(adapter);
    expect(gateway.supports('email')).toBe(true);

    const message = {
      target: 'test@example.com',
      code: '123456',
      purpose: 'email_verification' as const,
      expiresAt: Date.now() + 60_000,
    };
    await gateway.send('email', message);
    expect(adapter.send).toHaveBeenCalledWith(message);

    gateway.unregister('email');
    await expect(gateway.send('email', message)).rejects.toBeInstanceOf(
      OtpDeliveryUnavailableError,
    );
  });
});
