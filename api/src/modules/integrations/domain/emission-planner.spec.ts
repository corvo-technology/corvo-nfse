import {
  idempotencyKeyFor,
  planEmission,
  type PlanInput,
} from './emission-planner';
import type { NormalizedOperation } from './connector';
import type { IntegrationRule } from './integration-rule';

const rule: IntegrationRule = {
  id: 'r1',
  tenantId: 't',
  connectionId: 'c',
  externalProductId: null,
  service: { code: '010101', description: 'Consultoria' },
  sendEmail: true,
  allowAnonymousCustomer: false,
  cancelOnRefund: false,
};

function snapshot(
  over: Partial<NormalizedOperation> = {},
): NormalizedOperation {
  return {
    operationKey: 'charge:abc',
    commercialState: 'paid',
    externalRefs: {},
    occurredAt: new Date('2026-10-30T01:30:00Z'),
    paidAt: new Date('2026-10-30T01:30:00Z'),
    currency: 'BRL',
    amountCents: 4990,
    discountCents: 0,
    customer: {
      name: 'Maria',
      email: 'm@x.com',
      taxId: '52998224725',
      taxIdMasked: false,
    },
    items: [],
    sellerIssuesInvoice: true,
    ...over,
  };
}

function input(
  over: {
    snap?: Partial<NormalizedOperation>;
    state?: string;
    activeFrom?: Date | null;
    rules?: IntegrationRule[];
  } = {},
): PlanInput {
  const snap = snapshot(over.snap);
  return {
    tenantId: 'tenant-1',
    provider: 'woovi',
    connection: {
      id: 'c',
      companyId: 'company-1',
      state: (over.state ?? 'active') as never,
      activeFrom: over.activeFrom ?? null,
      environment: 'test',
      externalAccountId: 'acc',
    },
    operation: { snapshot: snap, commercialState: snap.commercialState },
    rules: over.rules ?? [rule],
  };
}

describe('planEmission', () => {
  it('plans an issue with amount 49.9 and the São Paulo competence date', () => {
    const plan = planEmission(input());
    expect(plan.kind).toBe('issue');
    if (plan.kind !== 'issue') return;
    expect(plan.request).toMatchObject({
      companyId: 'company-1',
      amount: 49.9,
      competenceDate: '2026-10-29',
      email: true,
      externalId: 'charge:abc',
      service: { code: '010101', description: 'Consultoria' },
      customer: { name: 'Maria', taxId: '52998224725', email: 'm@x.com' },
    });
    expect(plan.ruleId).toBe('r1');
  });
  describe('service description', () => {
    const bare: IntegrationRule = { ...rule, service: { code: '010101' } };
    const planned = (
      rules: IntegrationRule[],
      description: string | null | undefined,
    ) => {
      const plan = planEmission(
        input({ rules, snap: { description } as Partial<NormalizedOperation> }),
      );
      if (plan.kind !== 'issue') throw new Error('expected an issue plan');
      return plan.request.service;
    };
    it('uses what the platform said was sold when the rule sets no description', () => {
      expect(planned([bare], 'Plano Pro')).toEqual({
        code: '010101',
        description: 'Plano Pro',
      });
    });
    it('a description set on the rule wins over the one from the sale', () => {
      expect(planned([rule], 'Plano Pro')).toEqual({
        code: '010101',
        description: 'Consultoria',
      });
    });
    it('without either, leaves the description out so the company default applies', () => {
      expect(planned([bare], null)).toEqual({ code: '010101' });
      expect(planned([bare], undefined)).toEqual({ code: '010101' });
      expect(planned([bare], '   ')).toEqual({ code: '010101' });
    });
    it('cuts a very long description to 200 characters', () => {
      expect(planned([bare], 'x'.repeat(500))?.description).toHaveLength(200);
    });
  });
  it('puts discount in the request only when greater than zero', () => {
    const none = planEmission(input());
    const some = planEmission(input({ snap: { discountCents: 500 } }));
    if (none.kind !== 'issue' || some.kind !== 'issue')
      throw new Error('expected issue');
    expect(none.request).not.toHaveProperty('discount');
    expect(some.request.discount).toBe(5);
  });
  it('truncates externalId to 100 characters', () => {
    const plan = planEmission(
      input({ snap: { operationKey: 'k'.repeat(150) } }),
    );
    if (plan.kind !== 'issue') throw new Error('expected issue');
    expect(plan.request.externalId).toHaveLength(100);
  });
  it.each([
    ['refunded', 'refunded'],
    ['disputed', 'disputed'],
    ['pending', 'not_paid'],
    ['canceled', 'not_paid'],
  ] as const)('blocks a %s operation with %s', (state, reason) => {
    expect(planEmission(input({ snap: { commercialState: state } }))).toEqual({
      kind: 'blocked',
      reason,
    });
  });
  it('blocks with before_active_from when paid earlier than activeFrom', () => {
    expect(
      planEmission(input({ activeFrom: new Date('2026-11-01T00:00:00Z') })),
    ).toEqual({ kind: 'blocked', reason: 'before_active_from' });
  });
  it.each(['paused', 'reauth_required', 'draft', 'disconnected'])(
    'blocks connection_inactive for %s',
    (state) => {
      expect(planEmission(input({ state }))).toEqual({
        kind: 'blocked',
        reason: 'connection_inactive',
      });
    },
  );
  it.each([0, -5, 10.5])(
    'blocks invalid_amount for amountCents %s',
    (amountCents) => {
      expect(planEmission(input({ snap: { amountCents } }))).toEqual({
        kind: 'blocked',
        reason: 'invalid_amount',
      });
    },
  );
  it('blocks unsupported_currency and seller_not_issuer', () => {
    expect(planEmission(input({ snap: { currency: 'USD' } }))).toEqual({
      kind: 'blocked',
      reason: 'unsupported_currency',
    });
    expect(
      planEmission(input({ snap: { sellerIssuesInvoice: false } })),
    ).toEqual({ kind: 'blocked', reason: 'seller_not_issuer' });
  });
  it('needs_attention no_rule / ambiguous_rule', () => {
    expect(planEmission(input({ rules: [] }))).toEqual({
      kind: 'needs_attention',
      reason: 'no_rule',
    });
    const two = [
      { ...rule, id: 'a', externalProductId: 'p1' },
      { ...rule, id: 'b', externalProductId: 'p2' },
    ];
    const items = [
      { externalProductId: 'p1', description: null, quantity: 1 },
      { externalProductId: 'p2', description: null, quantity: 1 },
    ];
    expect(planEmission(input({ rules: two, snap: { items } }))).toEqual({
      kind: 'needs_attention',
      reason: 'ambiguous_rule',
    });
  });
  it.each([
    ['null taxId', { name: 'M', email: null, taxId: null, taxIdMasked: false }],
    [
      'masked taxId',
      { name: 'M', email: null, taxId: '123', taxIdMasked: true },
    ],
    [
      '12 digits',
      { name: 'M', email: null, taxId: '123456789012', taxIdMasked: false },
    ],
    ['no customer', null],
  ])('needs_attention customer_tax_id_missing for %s', (_n, customer) => {
    expect(planEmission(input({ snap: { customer } }))).toEqual({
      kind: 'needs_attention',
      reason: 'customer_tax_id_missing',
    });
  });
  it('issues without customer when the rule allows anonymous and the document is unusable', () => {
    const plan = planEmission(
      input({
        rules: [{ ...rule, allowAnonymousCustomer: true }],
        snap: {
          customer: { name: 'M', email: null, taxId: null, taxIdMasked: false },
        },
      }),
    );
    if (plan.kind !== 'issue') throw new Error('expected issue');
    expect(plan.request).not.toHaveProperty('customer');
  });
  it('accepts a 14 digit tax id', () => {
    const plan = planEmission(
      input({
        snap: {
          customer: {
            name: 'Acme',
            email: null,
            taxId: '11222333000181',
            taxIdMasked: false,
          },
        },
      }),
    );
    expect(plan.kind).toBe('issue');
  });
  it('idempotencyKeyFor is stable and ignores connection and rule', () => {
    const base = {
      tenantId: 't',
      environment: 'test' as const,
      provider: 'woovi',
      externalAccountId: 'acc',
      operationKey: 'charge:abc',
    };
    const a = idempotencyKeyFor(base);
    expect(a).toMatch(/^integ_[0-9a-f]{64}$/);
    expect(idempotencyKeyFor({ ...base })).toBe(a);
    expect(
      idempotencyKeyFor({ ...base, operationKey: 'charge:other' }),
    ).not.toBe(a);
    expect(idempotencyKeyFor({ ...base, environment: 'live' })).not.toBe(a);
  });
  it('requestHash is equal for equal requests and changes with the amount', () => {
    const a = planEmission(input());
    const b = planEmission(input());
    const c = planEmission(input({ snap: { amountCents: 5000 } }));
    if (a.kind !== 'issue' || b.kind !== 'issue' || c.kind !== 'issue')
      throw new Error('expected issue');
    expect(a.requestHash).toBe(b.requestHash);
    expect(c.requestHash).not.toBe(a.requestHash);
    expect(a.idempotencyKey).toBe(
      idempotencyKeyFor({
        tenantId: 'tenant-1',
        environment: 'test',
        provider: 'woovi',
        externalAccountId: 'acc',
        operationKey: 'charge:abc',
      }),
    );
  });
});
