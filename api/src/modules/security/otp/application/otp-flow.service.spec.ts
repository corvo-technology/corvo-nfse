import { OtpFlowService } from './otp-flow.service';
import {
  OtpDeliveryUnavailableError,
  OtpVerificationFailedError,
} from '../domain/otp-errors';

const request = {
  audience: 'public' as const,
  productKey: 'greenbarber',
  channel: 'email' as const,
  purpose: 'email_verification' as const,
  subjectId: 'public-subject',
  target: 'Test@Example.com',
};

describe('OtpFlowService', () => {
  const challenges = {
    issue: jest.fn(),
    verify: jest.fn(),
    revoke: jest.fn(),
  };
  const delivery = { supports: jest.fn(), send: jest.fn() };
  const proofs = { create: jest.fn() };
  const service = new OtpFlowService(
    challenges as never,
    delivery as never,
    proofs as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('fails before issuing when no delivery adapter exists', async () => {
    delivery.supports.mockReturnValue(false);

    await expect(service.request(request)).rejects.toBeInstanceOf(
      OtpDeliveryUnavailableError,
    );
    expect(challenges.issue).not.toHaveBeenCalled();
  });

  it('delivers internally and returns only public challenge metadata', async () => {
    delivery.supports.mockReturnValue(true);
    challenges.issue.mockResolvedValue({
      challengeId: 'challenge',
      code: '123456',
      normalizedTarget: 'test@example.com',
      maskedTarget: 't***@example.com',
      channel: 'email',
      expiresAt: 2,
      resendAvailableAt: 1,
    });

    const result = await service.request(request);

    expect(challenges.issue).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'test@example.com' }),
    );
    expect(delivery.send).toHaveBeenCalledWith(
      'email',
      expect.objectContaining({ code: '123456', target: 'test@example.com' }),
    );
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('normalizedTarget');
  });

  it('revokes the challenge when delivery fails', async () => {
    delivery.supports.mockReturnValue(true);
    challenges.issue.mockResolvedValue({
      challengeId: 'challenge',
      code: '123456',
      normalizedTarget: 'test@example.com',
      maskedTarget: 't***@example.com',
      channel: 'email',
      expiresAt: 2,
      resendAvailableAt: 1,
    });
    delivery.send.mockRejectedValue(new Error('provider failed'));

    await expect(service.request(request)).rejects.toBeInstanceOf(
      OtpDeliveryUnavailableError,
    );
    expect(challenges.revoke).toHaveBeenCalledWith('challenge');
  });

  it('exchanges a valid code for an opaque one-time proof', async () => {
    challenges.verify.mockResolvedValue({ valid: true });
    proofs.create.mockResolvedValue({ token: 'opaque', expiresAt: 123 });

    await expect(
      service.verify({
        ...request,
        challengeId: crypto.randomUUID(),
        code: '123456',
      }),
    ).resolves.toEqual({ verificationToken: 'opaque', expiresAt: 123 });

    challenges.verify.mockResolvedValueOnce({ valid: false });
    await expect(
      service.verify({
        ...request,
        challengeId: crypto.randomUUID(),
        code: '000000',
      }),
    ).rejects.toBeInstanceOf(OtpVerificationFailedError);
  });
});
