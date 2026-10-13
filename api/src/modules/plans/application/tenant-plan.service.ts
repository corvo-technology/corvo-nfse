import { TenantWorkDiscovery } from '@/infra/persistence/typeorm/tenant-work-discovery';
import { Injectable, Inject } from '@nestjs/common';
import type { ITenantPlanRepository } from '../domain/tenant-plan-assignment';
import { TENANT_PLAN_REPOSITORY } from '../domain/tenant-plan-assignment';
import { TenantPlanAssignment } from '../domain/tenant-plan-assignment';
import { IPlanRepository } from '../domain/plan.repository';

@Injectable()
export class TenantPlanService {
  constructor(
    private readonly discovery: TenantWorkDiscovery,
    @Inject(TENANT_PLAN_REPOSITORY)
    private readonly tenantPlanRepo: ITenantPlanRepository,
    private readonly planRepo: IPlanRepository,
  ) {}

  async getOrCreate(tenantId: string): Promise<TenantPlanAssignment> {
    const existing = await this.tenantPlanRepo.findByTenantId(tenantId);
    if (existing) return existing;

    // Default: assign Free plan
    const freePlan = await this.planRepo.findBySlug('free');
    if (!freePlan) throw new Error('Free plan not found');

    // Create initial assignment
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
    );

    return this.tenantPlanRepo.save(
      TenantPlanAssignment.reconstitute({
        tenantId,
        plan: freePlan,
        currentPeriodStart: monthStart,
        currentPeriodEnd: monthEnd,
        downgradeToPlanId: null,
        billingEmail: null,
        billingTaxId: null,
        createdAt: now,
        updatedAt: now,
      }),
      tenantId,
    );
  }

  async upgradePlan(
    tenantId: string,
    newPlanSlug: string,
  ): Promise<TenantPlanAssignment> {
    const newPlan = await this.planRepo.findBySlug(newPlanSlug);
    if (!newPlan) throw new Error(`Plan ${newPlanSlug} not found`);

    const existing = await this.getOrCreate(tenantId);
    const now = new Date();
    const newEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const snapshot = existing.toSnapshot();
    snapshot.currentPeriodStart = now;
    snapshot.currentPeriodEnd = newEnd;
    snapshot.downgradeToPlanId = null;
    // Note: This won't actually update plan since we're modifying the snapshot
    // We need to create a new assignment with the updated plan
    const updated = TenantPlanAssignment.reconstitute({
      ...snapshot,
      plan: newPlan,
    });

    return this.tenantPlanRepo.save(updated, tenantId);
  }

  async scheduleDowngrade(
    tenantId: string,
    newPlanSlug: string,
  ): Promise<TenantPlanAssignment> {
    const newPlan = await this.planRepo.findBySlug(newPlanSlug);
    if (!newPlan) throw new Error(`Plan ${newPlanSlug} not found`);

    const existing = await this.getOrCreate(tenantId);
    const snapshot = existing.toSnapshot();
    snapshot.downgradeToPlanId = newPlan.id;

    const updated = TenantPlanAssignment.reconstitute(snapshot);
    return this.tenantPlanRepo.save(updated, tenantId);
  }

  async ensurePeriodFresh(tenantId: string): Promise<TenantPlanAssignment> {
    const existing = await this.getOrCreate(tenantId);
    const now = new Date();

    if (!existing.isPeriodExpired(now) || existing.plan.slug !== 'free')
      return existing;

    // Determine new period
    const isFree = existing.plan.slug === 'free';
    let newStart: Date;
    let newEnd: Date;

    if (isFree) {
      newStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      newEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
      );
    } else {
      newStart = now;
      newEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    await this.tenantPlanRepo.updatePeriod(tenantId, newStart, newEnd);
    return (await this.tenantPlanRepo.findByTenantId(
      tenantId,
    )) as TenantPlanAssignment;
  }

  async applyScheduledDowngrades(): Promise<void> {
    const now = new Date();
    await this.discovery.visit('plan-expiry', async (tenantId) => {
      const expired = await this.tenantPlanRepo.findExpiredAssignments(
        tenantId,
        now,
      );

      for (const assignment of expired) {
        if (assignment.hasScheduledDowngrade()) {
          const newPlan = await this.planRepo.findById(
            assignment.downgradeToPlanId!,
          );
          if (newPlan) {
            // Update the plan
            const snapshot = assignment.toSnapshot();
            snapshot.plan = newPlan;
            snapshot.downgradeToPlanId = null;

            // Reset period
            const newStart = new Date();
            const newEnd = new Date(
              newStart.getTime() + 30 * 24 * 60 * 60 * 1000,
            );
            snapshot.currentPeriodStart = newStart;
            snapshot.currentPeriodEnd = newEnd;

            await this.tenantPlanRepo.save(
              TenantPlanAssignment.reconstitute(snapshot),
              tenantId,
            );
          }
        }
      }
    });
  }
}
