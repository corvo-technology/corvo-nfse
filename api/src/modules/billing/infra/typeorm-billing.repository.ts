import type { DocumentRef } from '@/modules/fiscal-core/domain/document-type';
import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { persistTenantEntity } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { WebhookEventOrmEntity } from '@/infra/persistence/typeorm/entities/webhook-event.orm-entity';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';
import { CreditTransactionOrmEntity } from '@/modules/credits/infra/credit-transaction.orm-entity';
import { BillingUsagePeriod } from './billing.orm-entity';
import {
  BillingRepository,
  type BillingState,
} from '../domain/billing.repository';
import type { BillingPeriodState } from '../domain/billing-period';
import { calendarPeriod, rollPeriod } from '../domain/billing-policy';
function nextMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

@Injectable()
export class TypeOrmBillingRepository extends BillingRepository {
  constructor(
    private readonly database: DataSource,
    private readonly context: TypeOrmTransactionContext,
  ) {
    super();
  }
  private get manager() {
    return this.context.getManager() ?? this.database.manager;
  }
  async lockedProviderEvent<T>(
    eventId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const existing = this.context.getManager();
    if (existing) {
      await existing.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`stripe:${eventId}`],
      );
      return work();
    }
    return this.database.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`stripe:${eventId}`],
      );
      return this.context.run(manager, work);
    });
  }
  async locked<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const existing = this.context.getManager();
      if (existing) {
        await existing.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`fiscal:${tenantId}`],
        );
        return work();
      }
      return this.database.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`fiscal:${tenantId}`],
        );
        return this.context.run(manager, work);
      });
    });
  }
  async current(tenantId: string, now = new Date()) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const tenant = await this.manager.findOneByOrFail(TenantOrmEntity, {
        id: tenantId,
      });
      const plan = tenant.planId
        ? await this.manager.findOneByOrFail(PlanOrmEntity, {
            id: tenant.planId,
          })
        : await this.manager.findOneByOrFail(PlanOrmEntity, { slug: 'free' });
      const billing = await this.billing(tenantId);
      const paid = plan.slug !== 'free';
      let { start, end } = calendarPeriod(now);
      if (paid && billing?.currentPeriodStart && billing.currentPeriodEnd) {
        start = billing.currentPeriodStart;
        end = billing.currentPeriodEnd;
        if (now >= end) {
          // Annual plans stay paid across many months: land on the month that contains `now`.
          const rolled = rollPeriod(start, end, billing.paidUntil, now);
          if (rolled.end > now) {
            start = rolled.start;
            end = rolled.end;
          } else {
            start = end;
            end = nextMonth(end);
          }
        }
      }
      const repo = this.manager.getRepository(BillingUsagePeriod);
      let period = await repo.findOneBy({
        tenantId,
        planSlug: plan.slug,
        periodStart: start,
      });
      if (!period) {
        period = repo.create({
          tenantId,
          planSlug: plan.slug,
          periodStart: start,
          periodEnd: end,
          included: plan.monthlyCreditAllowance,
          authorized: 0,
          reserved: 0,
          customerId: paid ? (billing?.stripeCustomerId ?? null) : null,
          subscriptionId: paid ? (billing?.stripeSubscriptionId ?? null) : null,
        });
        await repo.insert(period);
      }
      return { plan, billing, period };
    });
  }
  billing(tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.manager.findOneBy(TenantBillingOrmEntity, { tenantId });
    });
  }
  async saveBilling(tenantId: string, patch: Partial<BillingState>) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const {
        stripeCustomerId,
        stripeSubscriptionId,
        stripeStatus,
        paidUntil,
        pendingPlanSlug,
        cancelAtPeriodEnd,
        currentPeriodStart,
        currentPeriodEnd,
        billingEmail,
        checkoutState,
      } = patch;
      await this.manager.upsert(
        TenantBillingOrmEntity,
        {
          stripeCustomerId,
          stripeSubscriptionId,
          stripeStatus,
          paidUntil,
          pendingPlanSlug,
          cancelAtPeriodEnd,
          currentPeriodStart,
          currentPeriodEnd,
          billingEmail,
          checkoutState,
          tenantId,
        },
        ['tenantId'],
      );
    });
  }
  plan(slug: string) {
    return this.manager.findOneBy(PlanOrmEntity, { slug });
  }
  async setPlan(tenantId: string, planId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.manager.update(TenantOrmEntity, { id: tenantId }, { planId });
    });
  }
  async savePeriod(period: BillingPeriodState, tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await persistTenantEntity(
        this.manager.getRepository(BillingUsagePeriod),
        this.manager.create(BillingUsagePeriod, period),
        tenantId,
        ['periodStart', 'periodEnd', 'planSlug'],
      );
    });
  }
  period(id: string, tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.manager.findOneBy(BillingUsagePeriod, { id, tenantId });
    });
  }
  async reservedPeriod(invoiceId: string, tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.manager.findOneBy(CreditTransactionOrmEntity, {
        reservedInvoiceId: invoiceId,
        tenantId,
        isReservation: true,
      });
      return row?.periodId ?? null;
    });
  }
  async reservedPeriodFor(ref: DocumentRef) {
    if (ref.type === 'nfse') return this.reservedPeriod(ref.id, ref.tenantId);
    // The NFC-e lives in the NF-e table: its reservation uses the same column.
    if (ref.type !== 'nfe' && ref.type !== 'nfce')
      throw new Error(`No credit reservation for ${String(ref.type)}`);
    return runWithTenant(ref.tenantId, async () => {
      requireTenantId(ref.tenantId);
      const row = await this.manager.findOneBy(CreditTransactionOrmEntity, {
        reservedNfeDocumentId: ref.id,
        tenantId: ref.tenantId,
        isReservation: true,
      });
      return row?.periodId ?? null;
    });
  }
  avulsoBalance(tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const row = await this.manager
        .getRepository(CreditTransactionOrmEntity)
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.amount), 0)', 'sum')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere("t.source IN ('avulso', 'bonus')")
        .getRawOne<{ sum: string }>();
      return Number(row?.sum ?? 0);
    });
  }
  dailyUsage(tenantId: string) {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const refunds = this.manager
        .getRepository(CreditTransactionOrmEntity)
        .createQueryBuilder('refund')
        .select('1')
        .where(
          'refund.related_transaction_id = r.id AND refund.tenant_id = :tenantId',
          { tenantId },
        );
      return this.manager
        .getRepository(CreditTransactionOrmEntity)
        .createQueryBuilder('r')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.created_at >= :today', { today })
        .andWhere(
          "r.type = 'invoice_authorized' AND (r.reserved_invoice_id IS NOT NULL OR r.reserved_nfe_document_id IS NOT NULL)",
        )
        .andWhere(`NOT EXISTS (${refunds.getQuery()})`)
        .getCount();
    });
  }
  async customerTenant(customerId: string) {
    return runAsSystem('verified-provider-event', async () => {
      return (
        (
          await this.manager.findOneBy(TenantBillingOrmEntity, {
            stripeCustomerId: customerId,
          })
        )?.tenantId ?? null
      );
    });
  }
  eventSeen(id: string) {
    return this.manager.existsBy(WebhookEventOrmEntity, {
      provider: 'stripe',
      providerEventId: id,
    });
  }
  async recordEvent(id: string, type: string, hash: string) {
    const now = new Date();
    await this.manager.insert(WebhookEventOrmEntity, {
      id: randomUUID(),
      provider: 'stripe',
      providerEventId: id,
      eventType: type,
      payloadSha256: hash,
      status: 'processed',
      attempts: 1,
      availableAt: now,
      receivedAt: now,
      processedAt: now,
    });
  }
}
