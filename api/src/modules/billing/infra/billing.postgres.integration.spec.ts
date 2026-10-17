import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { WebhookEventOrmEntity } from '@/infra/persistence/typeorm/entities/webhook-event.orm-entity';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { TypeOrmPlanRepository } from '@/modules/plans/infra/typeorm-plan.repository';
import { PlanSeederService } from '@/modules/plans/application/plan-seeder.service';
import { TypeOrmBillingRepository } from './typeorm-billing.repository';
import { BillingUsageService } from '../application/billing-usage.service';
import { BillingService } from '../application/billing.service';
import { OverageReportService } from '../application/overage-report.service';
import type {
  BillingProvider,
  ProviderSubscription,
  ProviderCheckout,
} from '../domain/billing-provider.port';
import { BillingUsagePeriod } from './billing.orm-entity';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  )
    throw new Error('Billing tests require a local _test database');
}
const describePostgres = url ? describe : describe.skip;
const schema = `billing_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('Stripe billing with real PostgreSQL transactions', () => {
  let db: DataSource;
  let repository: TypeOrmBillingRepository;
  let usage: BillingUsageService;
  let service: BillingService;
  let reporter: OverageReportService;
  let provider: jest.Mocked<BillingProvider>;
  let context: TypeOrmTransactionContext;
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    await new PlanSeederService(
      new TypeOrmPlanRepository(
        db.getRepository(PlanOrmEntity),
        db.getRepository(TenantOrmEntity),
      ),
    ).seedIfMissing();
    context = new TypeOrmTransactionContext();
    repository = new TypeOrmBillingRepository(db, context);
    usage = new BillingUsageService(repository);
  }, 60000);
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
  });
  beforeEach(() => {
    provider = {
      enabled: true,
      createCustomer: jest.fn().mockResolvedValue(`cus_${randomUUID()}`),
      liveSubscriptions: jest.fn().mockResolvedValue([]),
      findCheckout: jest.fn().mockResolvedValue(null),
      createCheckout: jest
        .fn()
        .mockImplementation(async (customerId: string) => ({
          id: `cs_${randomUUID()}`,
          url: 'https://checkout.stripe.com/test',
          expiresAt: new Date(Date.now() + 86400000),
          status: 'open',
          paymentStatus: 'unpaid',
          customerId,
          subscriptionId: null,
        })),
      checkout: jest.fn(),
      subscription: jest.fn(),
      scheduleChange: jest.fn(),
      portal: jest.fn().mockResolvedValue('https://billing.stripe.com/test'),
      verifyEvent: jest.fn(),
      reportRoute: jest
        .fn()
        .mockResolvedValue({ route: 'meter', invoiceId: null }),
      reportMeter: jest.fn(),
      reportInvoiceItem: jest.fn(),
    };
    service = new BillingService(
      new TenantWorkDiscovery(db),
      repository,
      provider,
    );
    reporter = new OverageReportService(
      new TenantWorkDiscovery(db),
      repository,
      provider,
    );
  });
  async function tenant(slug = 'free') {
    const id = randomUUID();
    const plan = await repository.plan(slug);
    await db.manager.insert(TenantOrmEntity, { id, planId: plan!.id });
    await repository.saveBilling(id, {
      stripeCustomerId: `cus_${id}`,
      stripeStatus: slug === 'free' ? null : 'active',
      stripeSubscriptionId: slug === 'free' ? null : `sub_${id}`,
      paidUntil: slug === 'free' ? null : end,
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
    return id;
  }
  async function reserve(tenantId: string) {
    const invoiceId = randomUUID();
    await repository.locked(tenantId, async () => {
      const periodId = await usage.reserve(tenantId);
      const companyId = randomUUID();
      await context
        .getManager()!
        .query(
          `INSERT INTO "${schema}".nfse_companies (id,tenant_id,legal_name,tax_id,environment) VALUES ($1,$2,'Fixture','11222333000181','test')`,
          [companyId, tenantId],
        );
      await context
        .getManager()!
        .query(
          `INSERT INTO "${schema}".nfse_invoices (id,company_id,tenant_id,status,customer_snapshot,service_snapshot,tax_snapshot,amount,competence_date,environment) VALUES ($1,$2,$3,'queued','{}','{}','{}',10,'2026-10-11','test')`,
          [invoiceId, companyId, tenantId],
        );
      const manager = context.getManager()!;
      await manager.insert(CreditTransactionOrmEntity, {
        tenantId,
        amount: -1,
        type: 'invoice_authorized',
        reservedInvoiceId: invoiceId,
        periodId,
        isReservation: true,
      });
    });
    return invoiceId;
  }
  async function settle(
    tenantId: string,
    invoiceId: string,
    status = 'authorized',
  ) {
    await repository.locked(tenantId, async () => {
      await usage.settle(invoiceId, tenantId, status);
      const manager = context.getManager()!;
      await manager.update(
        CreditTransactionOrmEntity,
        { reservedInvoiceId: invoiceId },
        { isReservation: false },
      );
    });
  }
  function subscription(
    tenantId: string,
    patch: Partial<ProviderSubscription> = {},
  ) {
    return {
      id: `sub_${tenantId}`,
      customerId: `cus_${tenantId}`,
      status: 'active',
      planSlug: 'developer',
      periodStart: start,
      periodEnd: end,
      paidUntil: end,
      paidPlanSlug: 'developer',
      included: 200,
      unitCents: 15,
      cancelAtPeriodEnd: false,
      pendingPlanSlug: null,
      ...patch,
    };
  }
  it('adds only one billing table and keeps existing ledgers', async () => {
    const tables: { table_name: string }[] = await db.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND (table_name LIKE $2 OR table_name=$3)',
      [schema, 'billing_%', 'stripe_events'],
    );
    expect(tables.map((r) => r.table_name)).toEqual(['billing_usage_periods']);
    expect(db.hasMetadata(WebhookEventOrmEntity)).toBe(true);
  });
  it('reserves atomically at 5x, and authorizes a reservation only once', async () => {
    const id = await tenant('developer');
    const current = await usage.status(id);
    await db.manager.update(
      BillingUsagePeriod,
      { id: current.period.id },
      { authorized: 999 },
    );
    const results = await Promise.allSettled([reserve(id), reserve(id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const invoice = (
      results.find(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<string>
    ).value;
    await settle(id, invoice);
    await settle(id, invoice);
    expect(await usage.status(id)).toMatchObject({
      period: { authorized: 1000, reserved: 0 },
      overage_units: 800,
      overage_amount_cents: 12000,
    });
  });
  it('releases failures without charging excess', async () => {
    const id = await tenant('developer');
    const invoice = await reserve(id);
    await settle(id, invoice, 'failed');
    expect(await usage.status(id)).toMatchObject({
      period: { authorized: 0, reserved: 0 },
      overage_units: 0,
    });
  });
  it('retains the original period when an invoice finishes after renewal', async () => {
    const id = await tenant('developer');
    const invoice = await reserve(id);
    const original = (await usage.status(id)).period.id;
    const nextEnd = new Date(end);
    nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
    await repository.saveBilling(id, {
      currentPeriodStart: end,
      currentPeriodEnd: nextEnd,
      paidUntil: nextEnd,
    });
    await settle(id, invoice);
    expect(await repository.period(original, id)).toMatchObject({
      authorized: 1,
      reserved: 0,
    });
    expect((await usage.status(id)).period.authorized).toBe(0);
  });
  it('blocks unpaid legacy paid plans, preserving their historic credits', async () => {
    const id = await tenant('developer');
    await repository.saveBilling(id, { paidUntil: null, stripeStatus: null });
    await expect(reserve(id)).rejects.toMatchObject({ code: 'plan_blocked' });
  });
  it('rolls back reservations with the surrounding fiscal transaction', async () => {
    const id = await tenant('developer');
    await expect(
      repository.locked(id, async () => {
        await usage.reserve(id);
        throw new Error('fiscal insert failed');
      }),
    ).rejects.toThrow('fiscal insert failed');
    expect((await usage.status(id)).period.reserved).toBe(0);
  });
  it('creates one checkout for concurrent requests and replays its session', async () => {
    const id = await tenant();
    let session: ProviderCheckout;
    provider.createCheckout.mockImplementation(async (customerId: string) => {
      session = {
        id: `cs_${id}`,
        url: 'https://checkout.stripe.com/test',
        expiresAt: new Date(Date.now() + 86400000),
        status: 'open',
        paymentStatus: 'unpaid',
        customerId,
        subscriptionId: null,
      };
      return session;
    });
    provider.checkout.mockImplementation(async () => session);
    const results = await Promise.all([
      service.checkout(id, 'developer', 'request-1'),
      service.checkout(id, 'developer', 'request-1'),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(provider.createCheckout).toHaveBeenCalledTimes(1);
    await expect(
      service.checkout(id, 'growth', 'request-1'),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  it('checks Stripe for an existing subscription before opening another', async () => {
    const id = await tenant();
    provider.liveSubscriptions.mockResolvedValue(['existing']);
    await expect(
      service.checkout(id, 'developer', 'request'),
    ).rejects.toMatchObject({ code: 'subscription_exists' });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
  it('does not expose another tenant checkout', async () => {
    const id = await tenant();
    provider.checkout.mockResolvedValue({ customerId: 'another' });
    await expect(service.checkoutStatus(id, 'cs_other')).rejects.toMatchObject({
      code: 'checkout_not_found',
    });
  });
  it('activates only paid entitlement and deduplicates verified webhooks', async () => {
    const id = await tenant();
    provider.verifyEvent.mockReturnValue({
      id: 'evt_paid',
      type: 'invoice.paid',
      customerId: `cus_${id}`,
      subscriptionId: `sub_${id}`,
    });
    provider.subscription.mockResolvedValue(subscription(id));
    await service.webhook(Buffer.from('signed payload'), 'signature');
    await service.webhook(Buffer.from('signed payload'), 'signature');
    expect((await repository.current(id)).plan.slug).toBe('developer');
    expect(provider.subscription).toHaveBeenCalledTimes(1);
    expect(
      await db.manager.count(WebhookEventOrmEntity, {
        where: { provider: 'stripe', providerEventId: 'evt_paid' },
      }),
    ).toBe(1);
    const unpaid = await tenant();
    provider.verifyEvent.mockReturnValue({
      id: 'evt_unpaid',
      type: 'invoice.paid',
      customerId: `cus_${unpaid}`,
      subscriptionId: `sub_${unpaid}`,
    });
    provider.subscription.mockResolvedValue(
      subscription(unpaid, { paidUntil: null, paidPlanSlug: null }),
    );
    await service.webhook(Buffer.from('unpaid'), 'signature');
    expect((await repository.current(unpaid)).plan.slug).toBe('free');
  });
  it('rolls back webhook dedupe on provider failure so redelivery can retry', async () => {
    const id = await tenant();
    provider.verifyEvent.mockReturnValue({
      id: 'evt_failure',
      type: 'invoice.paid',
      customerId: `cus_${id}`,
      subscriptionId: `sub_${id}`,
    });
    provider.subscription.mockRejectedValueOnce(new Error('network failure'));
    await expect(
      service.webhook(Buffer.from('event'), 'signature'),
    ).rejects.toThrow('network failure');
    expect(await repository.eventSeen('evt_failure')).toBe(false);
    provider.subscription.mockResolvedValue(subscription(id));
    await service.webhook(Buffer.from('event'), 'signature');
    expect(await repository.eventSeen('evt_failure')).toBe(true);
  });
  it('pins the same overage request across a failed send and reports only the delta', async () => {
    const id = await tenant('developer');
    const { period } = await usage.status(id);
    await db.manager.update(
      BillingUsagePeriod,
      { id: period.id },
      { authorized: 250 },
    );
    provider.reportMeter.mockRejectedValueOnce(new Error('timeout'));
    await expect(reporter.reportPeriod(id, period.id)).rejects.toThrow(
      'timeout',
    );
    const pending = (await repository.period(period.id, id))!.pendingReport!;
    await db.manager.update(
      BillingUsagePeriod,
      { id: period.id },
      { authorized: 260 },
    );
    await reporter.reportPeriod(id, period.id);
    expect(provider.reportMeter.mock.calls[1][0]).toMatchObject({
      id: pending.id,
      units: 50,
    });
    await reporter.reportPeriod(id, period.id);
    expect(provider.reportMeter.mock.calls[2][0].units).toBe(10);
    expect((await repository.period(period.id, id))!.reported).toBe(60);
  });
  it('uses a pending invoice item for late finalized periods, never also a meter event', async () => {
    const id = await tenant('developer');
    const { period } = await usage.status(id);
    await db.manager.update(
      BillingUsagePeriod,
      { id: period.id },
      { authorized: 201 },
    );
    provider.reportRoute.mockResolvedValue({
      route: 'invoice_item',
      invoiceId: 'in_final',
    });
    await reporter.reportPeriod(id, period.id);
    expect(provider.reportMeter).not.toHaveBeenCalled();
    expect(provider.reportInvoiceItem).toHaveBeenCalledWith(
      expect.objectContaining({
        units: 1,
        unitCents: 15,
        invoiceId: 'in_final',
      }),
    );
  });
});
