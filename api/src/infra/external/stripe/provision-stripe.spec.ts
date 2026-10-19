import {
  assertKeySafety,
  provisionStripe,
  type ProvisionOptions,
} from '../../../../scripts/provision-stripe';

type Mutable = Record<string, jest.Mock>;

function mockStripe() {
  const products: Array<{ id: string; metadata: Record<string, string> }> = [];
  const meters: Array<{ id: string; event_name: string }> = [];
  const prices: Array<{
    id: string;
    lookup_key: string;
    active: boolean;
    currency: string;
    unit_amount: number;
    recurring: Record<string, unknown>;
    metadata: Record<string, string>;
  }> = [];
  let nextId = 1;

  const stripe = {
    products: {
      list: jest.fn(async function* () {
        for (const p of products) yield p;
      }),
      create: jest.fn(async (params: { metadata: Record<string, string> }) => {
        const product = { id: `prod_${nextId++}`, metadata: params.metadata };
        products.push(product);
        return product;
      }),
    },
    billing: {
      meters: {
        list: jest.fn(async function* () {
          for (const m of meters) yield m;
        }),
        create: jest.fn(async (params: { event_name: string }) => {
          const meter = {
            id: `meter_${nextId++}`,
            event_name: params.event_name,
          };
          meters.push(meter);
          return meter;
        }),
      },
    },
    prices: {
      list: jest.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: prices.filter((p) => lookup_keys.includes(p.lookup_key)),
      })),
      create: jest.fn(
        async (params: {
          lookup_key: string;
          unit_amount: number;
          metadata: Record<string, string>;
          recurring: Record<string, unknown>;
        }) => {
          const price = {
            id: `price_${nextId++}`,
            lookup_key: params.lookup_key,
            active: true,
            currency: 'brl',
            unit_amount: params.unit_amount,
            // Stripe defaults recurring.usage_type to 'licensed' when omitted.
            recurring: { usage_type: 'licensed', ...params.recurring },
            metadata: params.metadata,
          };
          prices.push(price);
          return price;
        },
      ),
      update: jest.fn(async (id: string, patch: Record<string, unknown>) => {
        const price = prices.find((p) => p.id === id);
        if (price) Object.assign(price, patch);
        return price;
      }),
    },
    billingPortal: {
      configurations: {
        list: jest.fn(async function* () {
          /* none seeded */
        }),
        create: jest.fn(async () => ({ id: 'bpc_1' })),
        update: jest.fn(async (id: string) => ({ id })),
      },
    },
    webhookEndpoints: {
      list: jest.fn(async () => ({ data: [] })),
      create: jest.fn(async () => ({ id: 'we_1', secret: 'whsec_x' })),
      update: jest.fn(async (id: string) => ({ id })),
    },
  };
  return { stripe, products, meters, prices };
}

describe('provisionStripe', () => {
  const opts = (apply: boolean): ProvisionOptions => ({ apply });

  it('makes zero mutating calls in dry run', async () => {
    const { stripe } = mockStripe();
    await provisionStripe(stripe as never, opts(false));
    expect((stripe.products as Mutable).create).not.toHaveBeenCalled();
    expect((stripe.prices as Mutable).create).not.toHaveBeenCalled();
    expect((stripe.prices as Mutable).update).not.toHaveBeenCalled();
    expect(
      (stripe.billing as { meters: Mutable }).meters.create,
    ).not.toHaveBeenCalled();
    expect(
      (stripe.billingPortal as { configurations: Mutable }).configurations
        .create,
    ).not.toHaveBeenCalled();
  });

  it('creates missing prices exactly once when applying', async () => {
    const { stripe, prices } = mockStripe();
    await provisionStripe(stripe as never, opts(true));
    // dev, pro, escala x (base + overage) = 6 prices
    expect(prices).toHaveLength(6);
    expect((stripe.prices as Mutable).create).toHaveBeenCalledTimes(6);
  });

  it('is idempotent: a second apply run creates nothing new', async () => {
    const { stripe, prices } = mockStripe();
    await provisionStripe(stripe as never, opts(true));
    const countAfterFirst = prices.length;
    (stripe.prices as Mutable).create.mockClear();
    (stripe.billing as { meters: Mutable }).meters.create.mockClear();
    (stripe.products as Mutable).create.mockClear();
    await provisionStripe(stripe as never, opts(true));
    expect(prices).toHaveLength(countAfterFirst);
    expect((stripe.prices as Mutable).create).not.toHaveBeenCalled();
    expect(
      (stripe.billing as { meters: Mutable }).meters.create,
    ).not.toHaveBeenCalled();
    expect((stripe.products as Mutable).create).not.toHaveBeenCalled();
  });

  it('refuses a live key without --live', () => {
    expect(() =>
      assertKeySafety('sk_live_abc', { apply: true, live: false }),
    ).toThrow(/--live/);
    expect(() =>
      assertKeySafety('sk_live_abc', { apply: true, live: true }),
    ).not.toThrow();
    expect(() =>
      assertKeySafety('rk_live_abc', { apply: true, live: false }),
    ).toThrow(/--live/);
    expect(() =>
      assertKeySafety('sk_test_abc', { apply: true, live: false }),
    ).not.toThrow();
  });
});
