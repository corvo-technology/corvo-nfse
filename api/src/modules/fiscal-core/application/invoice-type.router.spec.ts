import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { InvoiceCall, InvoiceRoutes } from './invoice-routes';
import { InvoiceTypeRouter } from './invoice-type.router';
import type { TypeormInvoiceSummaries } from '../infra/typeorm-invoice-summaries';

function build() {
  const summaries = { list: jest.fn() } as unknown as TypeormInvoiceSummaries;
  return { router: new InvoiceTypeRouter(summaries), summaries };
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
  it('404 RESOURCE_NOT_FOUND when no nfce routes are registered', () => {
    const { router } = build();
    expect(() =>
      router.forType('nfce', callOf('admin'), 'nfe.documents.view'),
    ).toThrow(NotFoundException);
  });

  it('403 PERMISSION_DENIED without the permission', () => {
    const { router } = build();
    router.register(routesOf('nfce'));
    expect(() =>
      router.forType('nfce', callOf('member'), 'nfe.documents.issue'),
    ).toThrow(ForbiddenException);
  });

  it('every workspace reaches the registered routes, with no release', () => {
    const { router } = build();
    const nfce = routesOf('nfce');
    router.register(nfce);
    expect(router.forType('nfce', callOf('admin'), 'nfe.documents.view')).toBe(
      nfce,
    );
  });

  it('owner asks every registered type', async () => {
    const { router } = build();
    const nfe = routesOf('nfe', false);
    const nfce = routesOf('nfce', true);
    router.register(nfe);
    router.register(nfce);
    const found = await router.owner('id', callOf('admin'), GATE.nfe);
    expect(found).toBe(nfce);
    expect(nfe.owns).toHaveBeenCalled();
  });

  it('summaries include nfe and nfce when registered', async () => {
    const { router, summaries } = build();
    router.register(routesOf('nfe'));
    router.register(routesOf('nfce'));
    (summaries.list as jest.Mock).mockResolvedValue({});
    await router.summaries({}, callOf('admin'), GATE);
    expect(summaries.list).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['nfse', 'nfe', 'nfce'] }),
      't1',
      'test',
    );
  });
});
