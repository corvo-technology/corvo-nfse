/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '@/infra/config/configuration.types';
import { TurnstileVerificationService } from './turnstile-verification.service';

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function config(
  secretKey = 'turnstile-secret',
  nodeEnv: AppConfiguration['app']['nodeEnv'] = 'test',
) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'app') {
        return { nodeEnv };
      }
      if (key === 'turnstile') {
        return { secretKey, allowedHostnames: ['corvo.tech'] };
      }
      return undefined;
    }),
  } as unknown as ConfigService<AppConfiguration>;
}

describe('TurnstileVerificationService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects a token issued for another action or hostname', async () => {
    const service = new TurnstileVerificationService(config());
    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, { success: true, hostname: 'corvo.tech', action: 'x' }),
    );
    await expect(
      service.verify({ token: 't', expectedAction: 'login' }),
    ).resolves.toEqual({ success: false, errorCodes: ['action-mismatch'] });

    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        success: true,
        hostname: 'evil.test',
        action: 'login',
      }),
    );
    await expect(
      service.verify({ token: 't', expectedAction: 'login' }),
    ).resolves.toEqual({ success: false, errorCodes: ['hostname-mismatch'] });

    fetchSpy.mockResolvedValueOnce(
      makeResponse(200, {
        success: true,
        hostname: 'corvo.tech',
        action: 'login',
      }),
    );
    await expect(
      service.verify({ token: 't', expectedAction: 'login' }),
    ).resolves.toMatchObject({ success: true, hostname: 'corvo.tech' });
  });

  it('bypasses Cloudflare verification in development', async () => {
    await expect(
      new TurnstileVerificationService(config('', 'development')).verify({
        token: 'local-dev-token',
      }),
    ).resolves.toEqual({ success: true });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends secret, token, remote IP and idempotency key to Cloudflare', async () => {
    fetchSpy.mockResolvedValue(
      makeResponse(200, {
        success: true,
        hostname: 'app.greenflow.test',
        action: 'contact',
        cdata: 'tenant-1',
        challenge_ts: '2026-06-13T12:00:00Z',
      }),
    );

    const result = await new TurnstileVerificationService(config()).verify({
      token: 'token-1',
      remoteIp: '203.0.113.10',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({
      secret: 'turnstile-secret',
      response: 'token-1',
      remoteip: '203.0.113.10',
      idempotency_key: expect.any(String),
    });
    expect(result).toEqual({
      success: true,
      hostname: 'app.greenflow.test',
      action: 'contact',
      cdata: 'tenant-1',
      challengeTs: '2026-06-13T12:00:00Z',
    });
  });

  it('preserves Cloudflare error codes when validation fails', async () => {
    fetchSpy.mockResolvedValue(
      makeResponse(200, {
        success: false,
        'error-codes': ['timeout-or-duplicate'],
      }),
    );

    await expect(
      new TurnstileVerificationService(config()).verify({ token: 'old-token' }),
    ).resolves.toEqual({
      success: false,
      errorCodes: ['timeout-or-duplicate'],
    });
  });

  it('fails with service unavailable when the secret is not configured', async () => {
    await expect(
      new TurnstileVerificationService(config('')).verify({ token: 'token-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails with bad gateway on network errors', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(
      new TurnstileVerificationService(config()).verify({ token: 'token-1' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('fails with bad gateway on invalid Cloudflare JSON shape', async () => {
    fetchSpy.mockResolvedValue(makeResponse(200, { ok: true }));

    await expect(
      new TurnstileVerificationService(config()).verify({ token: 'token-1' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
