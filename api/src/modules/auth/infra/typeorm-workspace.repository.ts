import { Injectable } from '@nestjs/common';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { TenantMembershipOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-membership.orm-entity';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';
import {
  IWorkspaceRepository,
  type NewWorkspace,
} from '../domain/workspace.repository';

@Injectable()
export class TypeOrmWorkspaceRepository extends IWorkspaceRepository {
  constructor(
    private readonly db: TypeOrmRepositoryHelper,
    private readonly transactions: TypeOrmTransactionContext,
  ) {
    super();
  }

  async lockUser(userId: string): Promise<void> {
    const manager = this.transactions.getManager();
    if (!manager) throw new Error('Workspace bootstrap requires a transaction');
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [userId],
    );
  }

  async memberships(userId: string): Promise<Array<{ isActive: boolean }>> {
    return this.db
      .repository(TenantMembershipOrmEntity)
      .find({ select: { isActive: true }, where: { authUserId: userId } });
  }

  async freePlanId(): Promise<string> {
    const plan = await this.db
      .repository(PlanOrmEntity)
      .findOneByOrFail({ slug: 'free' });
    return plan.id;
  }

  async hasFreeWorkspaceWithEmail(
    email: string,
    freePlanId: string,
  ): Promise<boolean> {
    return this.db
      .repository(TenantBillingOrmEntity)
      .createQueryBuilder('billing')
      .innerJoin(TenantOrmEntity, 'tenant', 'tenant.id = billing.tenantId')
      .where('LOWER(billing.billingEmail) = LOWER(:email)', { email })
      .andWhere('(tenant.planId = :planId OR tenant.planId IS NULL)', {
        planId: freePlanId,
      })
      .getExists();
  }

  async create(workspace: NewWorkspace): Promise<void> {
    await this.db
      .repository(TenantOrmEntity)
      .insert({ id: workspace.tenantId, planId: workspace.planId });
    await this.db.repository(TenantBillingOrmEntity).insert({
      tenantId: workspace.tenantId,
      billingEmail: workspace.billingEmail,
      currentPeriodStart: workspace.currentPeriodStart,
      currentPeriodEnd: workspace.currentPeriodEnd,
    });
    await this.db.repository(TenantMembershipOrmEntity).insert({
      tenantId: workspace.tenantId,
      authUserId: workspace.authUserId,
      role: workspace.role,
      permissions: workspace.permissions,
      isActive: true,
    });
  }
}
