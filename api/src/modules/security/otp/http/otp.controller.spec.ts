import { HttpException } from '@nestjs/common';
import {
  AuthenticatedOtpController,
  PublicOtpController,
} from './otp.controller';
import {
  InvalidOtpTargetError,
  OtpDeliveryUnavailableError,
} from '../domain/otp-errors';

const challengeId = '11111111-1111-4111-8111-111111111111';
const issueBody = {
  channel: 'email' as const,
  purpose: 'email_verification' as const,
  target: 'Test@Example.com',
};

describe('OTP HTTP controllers', () => {
  const otp = {
    request: jest.fn(),
    verify: jest.fn(),
    publicSubjectId: jest.fn().mockReturnValue('derived-public-subject'),
  };
  const response = { setHeader: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('derives the public subject and never returns the code or raw target', async () => {
    otp.request.mockResolvedValue({
      challengeId,
      channel: 'email',
      targetMasked: 't***@example.com',
      expiresAt: 1_700_000_300_000,
      resendAvailableAt: 1_700_000_060_000,
    });
    const controller = new PublicOtpController(otp as never);

    const result = await controller.request(
      {
        headers: {},
        ip: '127.0.0.1',
      },
      issueBody,
      response as never,
    );

    expect(otp.publicSubjectId).toHaveBeenCalledWith(
      'corvo',
      'email',
      'Test@Example.com',
    );
    expect(otp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'public',
        productKey: 'corvo',
        subjectId: 'derived-public-subject',
      }),
    );
    expect(result.data).not.toHaveProperty('code');
    expect(JSON.stringify(result)).not.toContain('Test@Example.com');
  });

  it('rejects privileged purposes on the public surface', async () => {
    const controller = new PublicOtpController(otp as never);

    await expect(
      controller.request(
        { headers: {} },
        {
          ...issueBody,
          purpose: 'payment_authorization',
          contextId: 'payment-1',
        },
        response as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(otp.request).not.toHaveBeenCalled();
  });

  it('maps unavailable delivery to a generic 503 response', async () => {
    otp.request.mockRejectedValue(new OtpDeliveryUnavailableError('email'));
    const controller = new PublicOtpController(otp as never);

    let error: unknown;
    try {
      await controller.request({ headers: {} }, issueBody, response as never);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'OTP_DELIVERY_UNAVAILABLE',
    });
  });

  it('maps malformed public targets to a safe 400 response', async () => {
    otp.publicSubjectId.mockImplementationOnce(() => {
      throw new InvalidOtpTargetError('email');
    });
    const controller = new PublicOtpController(otp as never);

    await expect(
      controller.request(
        { headers: {} },
        { ...issueBody, target: 'not-an-email' },
        response as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('binds authenticated challenges to authUserId and returns an opaque proof', async () => {
    otp.verify.mockResolvedValue({
      verificationToken: 'opaque-token',
      expiresAt: 1_700_000_300_000,
    });
    const controller = new AuthenticatedOtpController(otp as never);
    const req = {
      headers: {},
      authContext: { authUserId: 'auth-user-1' },
    };

    const result = await controller.verify(req as never, challengeId, {
      ...issueBody,
      code: '123456',
    });

    expect(otp.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId,
        audience: 'authenticated',
        subjectId: 'auth-user-1',
      }),
    );
    expect(result.data).toEqual({
      verificationToken: 'opaque-token',
      expiresAt: new Date(1_700_000_300_000).toISOString(),
    });
  });
});
