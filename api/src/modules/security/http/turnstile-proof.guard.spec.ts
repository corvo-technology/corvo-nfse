/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { AppConfiguration } from '@/infra/config/configuration';
import { recordHumanProofEvent } from '../observability/security.metrics';
import {
  TurnstileProofGuard,
  type HumanProofAction,
  type HumanProofEnforcement,
} from './turnstile-proof.guard';

jest.mock('../observability/security.metrics', () => ({
  recordHumanProofEvent: jest.fn(),
}));

describe('TurnstileProofGuard', () => {
  const actions: HumanProofAction[] = [
    'login',
    'signup',
    'booking',
    'waitlist',
    'customer_access',
    'appointment_cancel',
    'appointment_reschedule',
  ];
  const publicCustomerSessionActions: HumanProofAction[] = [
    'booking',
    'waitlist',
    'customer_access',
    'appointment_cancel',
    'appointment_reschedule',
  ];

  const makeGuard = (input: {
    action: HumanProofAction;
    enforcement?: HumanProofEnforcement;
    nodeEnv?: 'development' | 'test' | 'production';
    bypass?: boolean;
    turnstileEnforced?: boolean;
    publicCustomerSessionEnforced?: boolean;
  }) => {
    const reflector = {
      getAllAndOverride: jest.fn(() => ({
        action: input.action,
        enforcement: input.enforcement ?? 'always',
      })),
    } as unknown as Reflector;
    const attestations = { consume: jest.fn() };
    const turnstile = { verify: jest.fn() };
    const cookies = { name: jest.fn(() => 'gf_human_proof_dev') };
    const config = {
      get: jest.fn((key: keyof AppConfiguration) => {
        if (key === 'app') {
          return { nodeEnv: input.nodeEnv ?? 'test' };
        }
        if (key === 'turnstile') {
          return {
            developmentBypassEnabled: input.bypass ?? false,
            enforced: input.turnstileEnforced,
          };
        }
        if (
          key === 'publicCustomerSession' &&
          input.publicCustomerSessionEnforced !== undefined
        ) {
          return { enforced: input.publicCustomerSessionEnforced };
        }
        return undefined;
      }),
    } as unknown as ConfigService<AppConfiguration>;
    const request = {
      headers: {},
      cookies: {},
      params: {},
    };
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return {
      guard: new TurnstileProofGuard(
        reflector,
        attestations as any,
        turnstile as any,
        cookies as any,
        config,
      ),
      context,
      request,
      attestations,
      turnstile,
      cookies,
    };
  };

  it('lets requests through without proof while TURNSTILE_ENFORCED is off', async () => {
    const fixture = makeGuard({ action: 'login', turnstileEnforced: false });

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.attestations.consume).not.toHaveBeenCalled();
    expect(recordHumanProofEvent).toHaveBeenCalledWith(
      'proof_rollout_bypassed',
      'login',
    );
  });

  it('demands proof once TURNSTILE_ENFORCED is on', async () => {
    const fixture = makeGuard({ action: 'login', turnstileEnforced: true });

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each(actions)(
    'bypasses %s proof only when explicitly enabled in development',
    async (action) => {
      const fixture = makeGuard({
        action,
        nodeEnv: 'development',
        bypass: true,
      });

      await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
        true,
      );
      expect(fixture.cookies.name).not.toHaveBeenCalled();
      expect(fixture.attestations.consume).not.toHaveBeenCalled();
      expect(recordHumanProofEvent).toHaveBeenCalledWith(
        'proof_bypassed',
        action,
      );
    },
  );

  it.each(['test', 'production'] as const)(
    'fails closed in %s even if the bypass value reaches the guard',
    async (nodeEnv) => {
      const fixture = makeGuard({
        action: 'login',
        nodeEnv,
        bypass: true,
      });

      await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
        'Human verification required',
      );
      expect(fixture.attestations.consume).not.toHaveBeenCalled();
    },
  );

  it.each(publicCustomerSessionActions)(
    'keeps %s transparent while public customer session enforcement is disabled',
    async (action) => {
      const fixture = makeGuard({
        action,
        enforcement: 'public_customer_session',
        publicCustomerSessionEnforced: false,
      });

      await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
        true,
      );
      expect(fixture.cookies.name).not.toHaveBeenCalled();
      expect(fixture.attestations.consume).not.toHaveBeenCalled();
      expect(recordHumanProofEvent).toHaveBeenCalledWith(
        'proof_rollout_bypassed',
        action,
      );
    },
  );

  it.each(publicCustomerSessionActions)(
    'requires %s proof when public customer session enforcement is enabled',
    async (action) => {
      const fixture = makeGuard({
        action,
        enforcement: 'public_customer_session',
        publicCustomerSessionEnforced: true,
      });

      await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
        'Human verification required',
      );
      expect(fixture.cookies.name).toHaveBeenCalledWith(`human_${action}`);
      expect(fixture.attestations.consume).not.toHaveBeenCalled();
    },
  );

  it.each(['login', 'signup'] as const)(
    'keeps %s proof mandatory when public customer session enforcement is disabled',
    async (action) => {
      const fixture = makeGuard({
        action,
        publicCustomerSessionEnforced: false,
      });

      await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
        'Human verification required',
      );
    },
  );

  it('fails closed when rollout configuration is unavailable', async () => {
    const fixture = makeGuard({
      action: 'booking',
      enforcement: 'public_customer_session',
    });

    await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
      'Human verification required',
    );
  });

  it('keeps the existing proof requirement when development bypass is disabled', async () => {
    const fixture = makeGuard({
      action: 'login',
      nodeEnv: 'development',
      bypass: false,
    });

    await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
      'Human verification required',
    );
    expect(fixture.cookies.name).toHaveBeenCalledWith('human_login');
  });

  it('fails closed with service unavailable when Redis cannot consume a proof', async () => {
    const fixture = makeGuard({
      action: 'appointment_cancel',
      enforcement: 'public_customer_session',
      publicCustomerSessionEnforced: true,
    });
    fixture.request.cookies = {
      gf_human_proof_dev: 'proof-token',
    };
    fixture.attestations.consume.mockRejectedValue(new Error('redis down'));

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('validates an inline booking token before consulting the legacy cookie', async () => {
    const fixture = makeGuard({
      action: 'booking',
      enforcement: 'public_customer_session',
      publicCustomerSessionEnforced: true,
    });
    fixture.request.headers['x-turnstile-token'] = 'inline-token';
    fixture.turnstile.verify.mockResolvedValue({
      success: true,
      hostname: 'booking.greenbarber.com.br',
      action: 'booking',
    });

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.turnstile.verify).toHaveBeenCalledWith({
      token: 'inline-token',
      remoteIp: undefined,
    });
    expect(fixture.cookies.name).not.toHaveBeenCalled();
    expect(fixture.attestations.consume).not.toHaveBeenCalled();
    expect(recordHumanProofEvent).toHaveBeenCalledWith(
      'inline_proof_consumed',
      'booking',
    );
  });

  it('rejects an invalid inline token without downgrading to a legacy proof', async () => {
    const fixture = makeGuard({
      action: 'appointment_cancel',
      enforcement: 'public_customer_session',
      publicCustomerSessionEnforced: true,
    });
    fixture.request.headers['x-turnstile-token'] = 'invalid-token';
    fixture.request.cookies = { gf_human_proof_dev: 'legacy-proof' };
    fixture.turnstile.verify.mockResolvedValue({
      success: false,
      errorCodes: ['timeout-or-duplicate'],
    });

    await expect(fixture.guard.canActivate(fixture.context)).rejects.toThrow(
      'Invalid or expired human verification',
    );
    expect(fixture.attestations.consume).not.toHaveBeenCalled();
  });

  it('keeps the legacy proof fallback for booking actions during the transition', async () => {
    const fixture = makeGuard({
      action: 'appointment_reschedule',
      enforcement: 'public_customer_session',
      publicCustomerSessionEnforced: true,
    });
    fixture.request.cookies = { gf_human_proof_dev: 'legacy-proof' };
    fixture.attestations.consume.mockResolvedValue({
      action: 'appointment_reschedule',
      productKey: 'greenbarber',
      slug: null,
    });

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(recordHumanProofEvent).toHaveBeenCalledWith(
      'legacy_proof_consumed',
      'appointment_reschedule',
      'greenbarber',
    );
  });

  it('does not change the cookie proof flow for login', async () => {
    const fixture = makeGuard({ action: 'login' });
    fixture.request.headers['x-turnstile-token'] = 'ignored-inline-token';
    fixture.request.cookies = { gf_human_proof_dev: 'login-proof' };
    fixture.attestations.consume.mockResolvedValue({
      action: 'login',
      productKey: 'greenbarber',
      slug: null,
    });

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.turnstile.verify).not.toHaveBeenCalled();
    expect(recordHumanProofEvent).toHaveBeenCalledWith(
      'proof_consumed',
      'login',
      'greenbarber',
    );
  });
});
