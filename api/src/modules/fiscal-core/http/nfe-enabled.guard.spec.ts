import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import type { NfeAccessPolicy } from '../application/nfe-access.policy';
import { NfeEnabledGuard } from './nfe-enabled.guard';

const context = (tenantId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ authContext: tenantId ? { tenantId } : undefined }),
    }),
  }) as unknown as ExecutionContext;

const policy = (enabled: boolean) =>
  ({
    isEnabled: jest.fn().mockResolvedValue(enabled),
  }) as unknown as NfeAccessPolicy;

describe('NfeEnabledGuard', () => {
  it('lets the request through when NF-e is enabled', async () => {
    await expect(
      new NfeEnabledGuard(policy(true)).canActivate(context('t1')),
    ).resolves.toBe(true);
  });

  it('answers 404 RESOURCE_NOT_FOUND when it is not enabled', async () => {
    const attempt = new NfeEnabledGuard(policy(false)).canActivate(
      context('t1'),
    );
    await expect(attempt).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('answers 404 without a tenant', async () => {
    await expect(
      new NfeEnabledGuard(policy(true)).canActivate(context()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
