import * as sentry from '@/infra/observability/sentry-reporter';
import type { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { runWithAuditActor } from '@/modules/account-audit/application/audit-actor.context';
import type { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
import type { BillingProvider } from '../domain/billing-provider.port';
import type { BillingRepository } from '../domain/billing.repository';
import { BillingService } from './billing.service';

const body = Buffer.from('{"id":"evt"}');
const FUTURE = new Date(Date.now() + 20 * 86_400_000);

function build(
  opts: { currentSlug?: string; audit?: AccountAuditRecorder } = {},
) {
  const currentSlug = opts.currentSlug ?? 'free';
  const repository = {
    customerTenant: jest.fn().mockResolvedValue('tenant-1'),
    locked: jest.fn((_t: string, work: () => Promise<unknown>) => work()),
    lockedProviderEvent: jest.fn((_id: string, work: () => Promise<void>) =>
      work(),
    ),
    eventSeen: jest.fn().mockResolvedValue(false),
    recordEvent: jest.fn().mockResolvedValue(undefined),
    billing: jest.fn().mockResolvedValue({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    }),
    plan: jest.fn(async (slug: string) => ({
      id: `plan-${slug}`,
      slug,
      active: true,
    })),
    current: jest.fn().mockResolvedValue({
      plan: { id: `plan-${currentSlug}`, slug: currentSlug },
      period: { authorized: 0, reserved: 0, included: 0 },
    }),
    setPlan: jest.fn().mockResolvedValue(undefined),
    saveBilling: jest.fn().mockResolvedValue(undefined),
    savePeriod: jest.fn().mockResolvedValue(undefined),
  };
  const subscription = {
    id: 'sub_1',
    customerId: 'cus_1',
    status: 'active',
    planSlug: 'equipe',
    paidPlanSlug: 'equipe',
    periodStart: new Date(),
    periodEnd: FUTURE,
    paidUntil: FUTURE,
    included: 10000,
    cancelAtPeriodEnd: false,
    pendingPlanSlug: null,
  };
  const provider = {
    verifyEvent: jest.fn().mockReturnValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    }),
    subscription: jest.fn().mockResolvedValue(subscription),
    scheduleChange: jest.fn().mockResolvedValue(undefined),
  };
  const audit = opts.audit ?? new FakeAccountAudit();
  const service = new BillingService(
    {} as TenantWorkDiscovery,
    repository as unknown as BillingRepository,
    provider as unknown as BillingProvider,
    undefined,
    undefined,
    audit,
  );
  return { service, repository, audit: audit as FakeAccountAudit };
}

describe('BillingService audit', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records a plan change coming from the provider webhook as Sistema', async () => {
    const f = build({ currentSlug: 'free' });
    await f.service.webhook(body, 'sig');
    expect(f.audit.events).toHaveLength(1);
    expect(f.audit.events[0]).toMatchObject({
      tenantId: 'tenant-1',
      action: 'billing.plan_changed',
      actor: { type: 'system', id: null },
      target: { type: 'plan', id: 'equipe' },
      metadata: { from: 'free', to: 'equipe' },
    });
  });

  it('records the member who asked for the change when it comes from a request', async () => {
    const f = build({ currentSlug: 'free' });
    await runWithAuditActor({ type: 'user', id: 'u1' }, () =>
      f.service.changePlan('tenant-1', 'equipe'),
    );
    expect(f.audit.events).toHaveLength(1);
    expect(f.audit.events[0]).toMatchObject({
      action: 'billing.plan_changed',
      actor: { type: 'user', id: 'u1' },
    });
  });

  it('records nothing when the plan did not change', async () => {
    const f = build({ currentSlug: 'equipe' });
    await f.service.webhook(body, 'sig');
    expect(f.audit.events).toHaveLength(0);
  });

  it('keeps the action when the recorder fails', async () => {
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const f = build({ currentSlug: 'free', audit: failingAccountAudit() });
    await expect(f.service.webhook(body, 'sig')).resolves.toBeUndefined();
    expect(f.repository.setPlan).toHaveBeenCalled();
    expect(f.repository.recordEvent).toHaveBeenCalled();
  });
});
