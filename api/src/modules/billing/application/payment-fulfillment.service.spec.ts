import * as sentry from '@/infra/observability/sentry-reporter';
import { runWithAuditActor } from '@/modules/account-audit/application/audit-actor.context';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
import type { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import type { PaymentIntent } from '../domain/payment-intent';
import { PaymentFulfillmentService } from './payment-fulfillment.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: 'pay-1',
    tenantId: TENANT,
    kind: 'avulso',
    planSlug: null,
    cycle: null,
    units: 10,
    amountCents: 990,
    provider: 'woovi',
    providerRef: 'ref-1',
    idempotencyKey: 'k',
    status: 'paid',
    expiresAt: null,
    paidAt: new Date(),
    checkout: null,
    createdAt: new Date(),
    ...over,
  };
}

function build(
  opts: { granted?: number; from?: string; audit?: AccountAuditRecorder } = {},
) {
  const credits = {
    grantAvulso: jest
      .fn()
      .mockResolvedValue({ creditsGranted: opts.granted ?? 10 }),
  };
  const billing = {
    plan: jest.fn(async (slug: string) => ({ id: `id-${slug}`, slug })),
    current: jest.fn(async () => ({
      plan: { id: 'id-from', slug: opts.from ?? 'free' },
    })),
    setPlan: jest.fn().mockResolvedValue(undefined),
    saveBilling: jest.fn().mockResolvedValue(undefined),
    locked: jest.fn(async (_t: string, work: () => Promise<unknown>) => work()),
  };
  const audit = opts.audit ?? new FakeAccountAudit();
  const service = new PaymentFulfillmentService(
    credits as never,
    billing as never,
    { publishBestEffort: jest.fn() } as never,
    audit,
  );
  return { service, credits, billing, audit: audit as FakeAccountAudit };
}

describe('PaymentFulfillmentService audit', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records a webhook payment confirmation as Sistema', async () => {
    const f = build();
    await f.service.apply(intent());
    expect(f.audit.events).toHaveLength(1);
    expect(f.audit.events[0]).toMatchObject({
      tenantId: TENANT,
      action: 'billing.payment_confirmed',
      actor: { type: 'system', id: null },
      target: { type: 'payment', id: 'pay-1' },
      metadata: {
        provider: 'woovi',
        method: 'pix',
        kind: 'avulso',
        units: 10,
        amount_cents: 990,
      },
    });
  });

  it('keeps the confirmation as Sistema even inside a member request scope', async () => {
    const f = build();
    await runWithAuditActor({ type: 'user', id: 'u1' }, () =>
      f.service.apply(intent()),
    );
    expect(f.audit.events[0].actor.type).toBe('system');
  });

  it('records nothing for a redelivered webhook that granted no credits', async () => {
    const f = build({ granted: 0 });
    await f.service.apply(intent());
    expect(f.audit.events).toHaveLength(0);
  });

  it('records the plan change and the confirmation for a plan payment', async () => {
    const f = build({ from: 'free' });
    await f.service.apply(
      intent({
        kind: 'plan',
        planSlug: 'solo',
        cycle: 'annual',
        units: null,
        amountCents: 50280,
      }),
    );
    expect(f.audit.events.map((e) => e.action)).toEqual([
      'billing.plan_changed',
      'billing.payment_confirmed',
    ]);
    expect(f.audit.events[0]).toMatchObject({
      tenantId: TENANT,
      target: { type: 'plan', id: 'solo', label: 'solo' },
      actor: { type: 'system', id: null },
      metadata: { from: 'free', to: 'solo' },
    });
  });

  it('does not record a plan change when the plan stays the same (a renewal)', async () => {
    const f = build({ from: 'solo' });
    await f.service.activatePlan(TENANT, 'solo', 'monthly');
    expect(f.audit.events).toHaveLength(0);
  });

  it('keeps the action when the recorder fails', async () => {
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const f = build({ audit: failingAccountAudit() });
    await expect(f.service.apply(intent())).resolves.toBeUndefined();
    expect(f.credits.grantAvulso).toHaveBeenCalled();
    await expect(
      f.service.activatePlan(TENANT, 'solo', 'monthly'),
    ).resolves.toBeUndefined();
    expect(f.billing.setPlan).toHaveBeenCalled();
  });
});
