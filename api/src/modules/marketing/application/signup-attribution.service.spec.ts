import type { ConfigService } from '@nestjs/config';
import { QueuePort } from '@/infra/redis/queue.port';
import type { AuthUserService } from '@/modules/auth/application/auth-user.service';
import type { AuthContext } from '@/modules/auth/auth-context';
import { SignupAttributionService } from './signup-attribution.service';
import { IAuthUserAttributionRepository } from '../domain/auth-user-attribution.repository';

function authContextFor(
  authUserId: string,
  activeTenantId: string,
): AuthContext {
  return {
    authUserId,
    productKey: 'corvo',
    userId: authUserId,
    tenantId: activeTenantId,
    activeTenantId,
    role: 'admin',
    contextType: 'tenant',
    platformRole: null,
    platformPermissions: [],
    permissions: [],
    isPlatformAdmin: false,
  };
}

describe('SignupAttributionService', () => {
  const user = {
    id: 'user-1',
    email: 'new@example.com',
    name: 'New User',
    emailVerifiedAt: new Date(),
    primaryIdentityType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function build(
    options: {
      enabled?: boolean;
      recordIfAbsent?: boolean;
      findById?: typeof user | null;
    } = {},
  ) {
    const authUserService = {
      findById: jest
        .fn()
        .mockResolvedValue(
          options.findById === undefined ? user : options.findById,
        ),
    } as unknown as AuthUserService;

    const attributions = {
      recordIfAbsent: jest
        .fn()
        .mockResolvedValue(options.recordIfAbsent ?? true),
    } as unknown as jest.Mocked<IAuthUserAttributionRepository>;

    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as unknown as jest.Mocked<QueuePort>;

    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        pixelId: 'pixel-1',
        capiToken: 'token',
        capiEnabled: options.enabled ?? true,
        capiTestEventCode: undefined,
      }),
    } as unknown as ConfigService;

    const service = new SignupAttributionService(
      authUserService,
      attributions,
      queue,
      config,
    );
    return { service, authUserService, attributions, queue, config };
  }

  const baseInput = { eventId: 'evt-1', consent: true };

  it('does not record when consent is false', async () => {
    const { service, attributions } = build();
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      { ...baseInput, consent: false },
      {},
    );
    expect(result).toEqual({ recorded: false });
    expect(attributions.recordIfAbsent).not.toHaveBeenCalled();
  });

  it('does not record for an invited member (tenant differs from the user id)', async () => {
    const { service, attributions } = build();
    const result = await service.record(
      authContextFor('user-1', 'someone-elses-tenant'),
      baseInput,
      {},
    );
    expect(result).toEqual({ recorded: false });
    expect(attributions.recordIfAbsent).not.toHaveBeenCalled();
  });

  it('does not record when the account is older than 24 hours', async () => {
    const oldUser = {
      ...user,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    };
    const { service, attributions } = build({ findById: oldUser });
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      baseInput,
      {},
    );
    expect(result).toEqual({ recorded: false });
    expect(attributions.recordIfAbsent).not.toHaveBeenCalled();
  });

  it('records once and enqueues the CompleteRegistration CAPI job', async () => {
    const { service, attributions, queue } = build();
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      {
        ...baseInput,
        utm: { source: 'meta' },
        fbc: 'fb.1.1.1',
        fbp: 'fb.1.2.2',
      },
      { clientIp: '203.0.113.5', userAgent: 'UA' },
    );
    expect(result).toEqual({ recorded: true });
    expect(attributions.recordIfAbsent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ eventId: 'evt-1' }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'meta-capi',
      'CompleteRegistration',
      expect.objectContaining({
        kind: 'CompleteRegistration',
        eventId: 'evt-1',
        authUserId: 'user-1',
        email: 'new@example.com',
        clientIp: '203.0.113.5',
        userAgent: 'UA',
      }),
      expect.objectContaining({
        attempts: 5,
        jobId: 'capi:CompleteRegistration:user-1',
      }),
    );
  });

  it('returns recorded:false on a second call for the same user (already attributed)', async () => {
    const { service, queue } = build({ recordIfAbsent: false });
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      baseInput,
      {},
    );
    expect(result).toEqual({ recorded: false });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('records the attribution but does not enqueue when Meta CAPI is disabled', async () => {
    const { service, queue, attributions } = build({ enabled: false });
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      baseInput,
      {},
    );
    expect(result).toEqual({ recorded: true });
    expect(attributions.recordIfAbsent).toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not fail the request when enqueueing throws', async () => {
    const { service, queue } = build();
    (queue.add as jest.Mock).mockRejectedValue(new Error('redis down'));
    const result = await service.record(
      authContextFor('user-1', 'user-1'),
      baseInput,
      {},
    );
    expect(result).toEqual({ recorded: true });
  });
});
