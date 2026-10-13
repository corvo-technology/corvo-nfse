import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import {
  ITenantPlanRepository,
  TenantPlanAssignment,
} from '../domain/tenant-plan-assignment';
import { IPlanRepository } from '../domain/plan.repository';
import { Plan } from '../domain/plan';
import { PlanOrmEntity } from './plan.orm-entity';

const FREE_PLAN_SLUG = 'free';

@Injectable()
export class TypeOrmTenantPlanRepository implements ITenantPlanRepository {
  constructor(
    @InjectRepository(TenantOrmEntity)
    private readonly tenants: Repository<TenantOrmEntity>,
    @InjectRepository(TenantBillingOrmEntity)
    private readonly billing: Repository<TenantBillingOrmEntity>,
    private readonly planRepo: IPlanRepository,
  ) {}

  async findByTenantId(tenantId: string): Promise<TenantPlanAssignment | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const tenant = await this.tenants.findOne({ where: { id: tenantId } });
      if (!tenant) return null;

      const bill = await this.billing.findOne({ where: { tenantId } });
      const plan = await this.resolvePlan(tenant.planId);
      return plan ? this.toAssignment(tenant, bill, plan) : null;
    });
  }

  async save(
    assignment: TenantPlanAssignment,
    tenantId: string,
  ): Promise<TenantPlanAssignment> {
    return runWithTenant(tenantId, async () => {
      const s = assignment.toSnapshot();
      assertTenantOwnership(tenantId, s.tenantId);

      await this.tenants.manager.transaction(async (manager) => {
        await manager.upsert(
          TenantOrmEntity,
          {
            id: s.tenantId,
            planId: s.plan.id,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          },
          ['id'],
        );
        await manager.upsert(
          TenantBillingOrmEntity,
          {
            tenantId: s.tenantId,
            currentPeriodStart: s.currentPeriodStart,
            currentPeriodEnd: s.currentPeriodEnd,
            downgradeToPlanId: s.downgradeToPlanId,
            billingEmail: s.billingEmail,
            billingTaxId: s.billingTaxId,
            updatedAt: s.updatedAt,
          },
          ['tenantId'],
        );
      });

      return assignment;
    });
  }

  async updatePeriod(tenantId: string, start: Date, end: Date): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.billing.upsert(
        { tenantId, currentPeriodStart: start, currentPeriodEnd: end },
        ['tenantId'],
      );
    });
  }

  async scheduleDowngrade(
    tenantId: string,
    newPlanId: string | null,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.billing.upsert({ tenantId, downgradeToPlanId: newPlanId }, [
        'tenantId',
      ]);
    });
  }

  async findExpiredAssignments(
    tenantId: string,
    now: Date,
  ): Promise<TenantPlanAssignment[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const expired = await this.billing.find({
        where: { tenantId, currentPeriodEnd: LessThan(now) },
      });

      const assignments: TenantPlanAssignment[] = [];
      for (const bill of expired) {
        const tenant = await this.tenants.findOne({
          where: { id: bill.tenantId },
        });
        if (!tenant) continue;
        const plan = await this.resolvePlan(tenant.planId);
        if (plan) assignments.push(this.toAssignment(tenant, bill, plan));
      }
      return assignments;
    });
  }

  async setBillingInfo(
    tenantId: string,
    email: string,
    taxId: string,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      await this.billing.upsert(
        { tenantId, billingEmail: email.toLowerCase(), billingTaxId: taxId },
        ['tenantId'],
      );
    });
  }

  existsFreeTenantWithBillingEmail(email: string): Promise<boolean> {
    return this.existsFreeTenant('billingEmail', email.toLowerCase());
  }

  existsFreeTenantWithBillingTaxId(taxId: string): Promise<boolean> {
    return this.existsFreeTenant('billingTaxId', taxId);
  }

  private existsFreeTenant(
    field: 'billingEmail' | 'billingTaxId',
    value: string,
  ): Promise<boolean> {
    return runAsSystem('billing-eligibility', async () => {
      return this.billing
        .createQueryBuilder('billing')
        .innerJoin(TenantOrmEntity, 'tenant', 'tenant.id = billing.tenantId')
        .innerJoin(
          PlanOrmEntity,
          'plan',
          'plan.id = tenant.planId OR (tenant.planId IS NULL AND plan.slug = :slug)',
        )
        .where(`billing.${field} = :value`, { value })
        .andWhere('plan.slug = :slug', { slug: FREE_PLAN_SLUG })
        .getExists();
    });
  }

  private async resolvePlan(planId: string | null): Promise<Plan | null> {
    const plan = planId ? await this.planRepo.findById(planId) : null;
    return plan ?? this.planRepo.findBySlug(FREE_PLAN_SLUG);
  }

  private toAssignment(
    tenant: TenantOrmEntity,
    bill: TenantBillingOrmEntity | null,
    plan: Plan,
  ): TenantPlanAssignment {
    return TenantPlanAssignment.reconstitute({
      tenantId: tenant.id,
      plan,
      currentPeriodStart: bill?.currentPeriodStart ?? new Date(),
      currentPeriodEnd: bill?.currentPeriodEnd ?? new Date(),
      downgradeToPlanId: bill?.downgradeToPlanId ?? null,
      billingEmail: bill?.billingEmail ?? null,
      billingTaxId: bill?.billingTaxId ?? null,
      createdAt: tenant.createdAt,
      updatedAt: bill?.updatedAt ?? tenant.updatedAt,
    });
  }
}
