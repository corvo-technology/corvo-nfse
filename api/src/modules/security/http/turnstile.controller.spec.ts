/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PUBLIC_ROUTE_KEY } from '@/modules/auth/application/public-route.decorator';
import { TurnstileController } from './turnstile.controller';

describe('TurnstileController', () => {
  const service = { verify: jest.fn() };
  const attestations = {
    assertVerifyRate: jest.fn().mockResolvedValue(true),
    create: jest.fn().mockResolvedValue('proof-token'),
  };
  const cookies = { set: jest.fn() };
  const controller = new TurnstileController(
    service as any,
    attestations as any,
    cookies as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('accepts token and uses CF-Connecting-IP from a trusted proxy request', async () => {
    service.verify.mockResolvedValue({ success: true, hostname: 'site.test' });

    await expect(
      controller.verify(
        { headers: { 'cf-connecting-ip': '203.0.113.10' }, ip: '10.0.0.1' },
        { token: 'token-1' },
      ),
    ).resolves.toEqual({ data: { success: true, hostname: 'site.test' } });
    expect(service.verify).toHaveBeenCalledWith({
      token: 'token-1',
      remoteIp: '203.0.113.10',
    });
  });

  it('issues the human-proof cookie when an action is verified', async () => {
    service.verify.mockResolvedValue({ success: true, hostname: 'corvo.tech' });
    const res = {} as any;

    const result = await controller.verify(
      { headers: {}, ip: '203.0.113.9' },
      { token: 't', action: 'login' },
      res,
    );

    expect(service.verify).toHaveBeenCalledWith(
      expect.objectContaining({ expectedAction: 'login' }),
    );
    expect(cookies.set).toHaveBeenCalledWith(
      res,
      'human_login',
      'proof-token',
      undefined,
      30 * 60 * 1000,
    );
    expect(result.data).toMatchObject({ isVerified: true });
  });

  it('does not issue a cookie when the challenge fails', async () => {
    service.verify.mockResolvedValue({
      success: false,
      errorCodes: ['action-mismatch'],
    });

    const result = await controller.verify(
      { headers: {}, ip: '203.0.113.9' },
      { token: 't', action: 'login' },
      {} as any,
    );

    expect(cookies.set).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      isVerified: false,
      errorCodes: ['action-mismatch'],
    });
  });

  it('accepts response and uses the first X-Forwarded-For IP', async () => {
    service.verify.mockResolvedValue({ success: false, errorCodes: [] });

    await controller.verify(
      {
        headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
        ip: '10.0.0.1',
      },
      { response: 'response-token' },
    );

    expect(service.verify).toHaveBeenCalledWith({
      token: 'response-token',
      remoteIp: '198.51.100.2',
    });
  });

  it('ignores forwarded IP headers when the remote IP is not trusted', async () => {
    service.verify.mockResolvedValue({ success: true });

    await controller.verify(
      {
        headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
        ip: '203.0.113.9',
      },
      { token: 'token-1' },
    );

    expect(service.verify).toHaveBeenCalledWith({
      token: 'token-1',
      remoteIp: '203.0.113.9',
    });
  });

  it('accepts cfTurnstileResponse and falls back to req.ip', async () => {
    service.verify.mockResolvedValue({ success: false, errorCodes: [] });

    await controller.verify(
      { headers: {}, ip: '192.0.2.4' },
      { cfTurnstileResponse: 'cf-token' },
    );

    expect(service.verify).toHaveBeenCalledWith({
      token: 'cf-token',
      remoteIp: '192.0.2.4',
    });
  });

  it('uses token before response and cfTurnstileResponse', async () => {
    service.verify.mockResolvedValue({ success: true });

    await controller.verify(
      { headers: {} },
      {
        token: 'token-first',
        response: 'response-second',
        cfTurnstileResponse: 'cf-third',
      },
    );

    expect(service.verify).toHaveBeenCalledWith({
      token: 'token-first',
      remoteIp: undefined,
    });
  });

  it('rejects a body without a token', async () => {
    await expect(controller.verify({ headers: {} }, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.verify).not.toHaveBeenCalled();
  });

  it('is public and applies a 20/min throttle', () => {
    expect(
      Reflect.getMetadata(
        PUBLIC_ROUTE_KEY,
        TurnstileController.prototype.verify,
      ),
    ).toBe(true);
    expect(Reflect.getMetadata(PATH_METADATA, TurnstileController)).toBe(
      'public/security/turnstile',
    );
    expect(
      Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        TurnstileController.prototype.verify,
      ),
    ).toBe(20);
    expect(
      Reflect.getMetadata(
        'THROTTLER:TTLdefault',
        TurnstileController.prototype.verify,
      ),
    ).toBe(60_000);
  });
});
