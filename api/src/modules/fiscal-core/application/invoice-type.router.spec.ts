import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { InvoiceCall, InvoiceRoutes } from './invoice-routes';
import { InvoiceTypeRouter } from './invoice-type.router';
import type { NfeAccessPolicy } from './nfe-access.policy';
import type { TypeormInvoiceSummaries } from '../infra/typeorm-invoice-summaries';

function build(enabled: Record<'nfe' | 'nfce', boolean>) {
  const access = {
    isEnabled: jest.fn((_t: string, type: 'nfe' | 'nfce' = 'nfe') =>
      Promise.resolve(enabled[type]),
    ),
  } as unknown as NfeAccessPolicy;
  const summaries = { list: jest.fn() } as unknown as TypeormInvoiceSummaries;
  return {
    router: new InvoiceTypeRouter(access, summaries),
    access,
    summaries,
  };
}

const routesOf = (type: 'nfe' | 'nfce', owns = false) =>
  ({
    type,
    owns: jest.fn().mockResolvedValue(owns),
  }) as unknown as InvoiceRoutes;

function callOf(role: 'admin' | 'member'): InvoiceCall {
  return {
    tenantId: 't1',
    environment: 'test',
    auth: {
      role,
      principalType: 'tenant_member',
      activeTenantId: 't1',
      permissions: [],
    },
  } as unknown as InvoiceCall;
}

const GATE = { nfse: 'nfse.invoices.view', nfe: 'nfe.documents.view' } as const;

describe('InvoiceTypeRouter with nfce', () => {
  it('404 RESOURCE_NOT_FOUND when no nfce routes are registered', async () => {
    const { router } = build({ nfe: true, nfce: true });
    await expect(
      router.forType('nfce', callOf('admin'), 'nfe.documents.view'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 when the tenant is not released for NFC-e, even if released for NF-e', async () => {
    const { router, access } = build({ nfe: true, nfce: false });
    router.register(routesOf('nfce'));
    await expect(
      router.forType('nfce', callOf('admin'), 'nfe.documents.view'),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(access.isEnabled).toHaveBeenCalledWith('t1', 'nfce');
  });

  it('403 PERMISSION_DENIED when released but without the permission', async () => {
    const { router } = build({ nfe: true, nfce: true });
    router.register(routesOf('nfce'));
    await expect(
      router.forType('nfce', callOf('member'), 'nfe.documents.issue'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('owner only looks at the routes whose type is released', async () => {
    const { router } = build({ nfe: false, nfce: true });
    const nfe = routesOf('nfe', true);
    const nfce = routesOf('nfce', true);
    router.register(nfe);
    router.register(nfce);
    const found = await router.owner('id', callOf('admin'), GATE.nfe);
    expect(found).toBe(nfce);
    expect(nfe.owns).not.toHaveBeenCalled();
  });

  it('summaries include nfce only when released', async () => {
    const { router, summaries } = build({ nfe: true, nfce: false });
    router.register(routesOf('nfe'));
    router.register(routesOf('nfce'));
    (summaries.list as jest.Mock).mockResolvedValue({});
    await router.summaries({}, callOf('admin'), GATE);
    expect(summaries.list).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['nfse', 'nfe'] }),
      't1',
      'test',
    );
  });
});
