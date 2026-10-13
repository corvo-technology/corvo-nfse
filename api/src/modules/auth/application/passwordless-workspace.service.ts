import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { TenantMembershipOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-membership.orm-entity';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';
import type { AuthUser } from '../domain/auth-user';
import { permissionsForTenantRole } from '../domain/permission';

@Injectable()
export class PasswordlessWorkspaceService {
  constructor(private readonly dataSource: DataSource) {}

  async ensureWorkspace(user: AuthUser): Promise<void> {
    return runAsSystem('workspace-bootstrap', async () => {
      await this.dataSource.transaction(async (manager) => {
        // Serialize first login for this account, including simultaneous challenges.
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [user.id],
        );
        const memberships = await manager.find(TenantMembershipOrmEntity, {
          where: { authUserId: user.id },
        });
        if (memberships.some((membership) => membership.isActive)) return;
        if (memberships.length)
          throw new ForbiddenException('Tenant membership is inactive');

        const free = await manager.findOneByOrFail(PlanOrmEntity, {
          slug: 'free',
        });
        const reusedEmail = await manager
          .createQueryBuilder(TenantBillingOrmEntity, 'billing')
          .innerJoin(TenantOrmEntity, 'tenant', 'tenant.id = billing.tenantId')
          .where('LOWER(billing.billingEmail) = LOWER(:email)', {
            email: user.email,
          })
          .andWhere('(tenant.planId = :planId OR tenant.planId IS NULL)', {
            planId: free.id,
          })
          .getExists();
        if (reusedEmail)
          throw new ConflictException(
            'Email already belongs to a free workspace',
          );

        const now = new Date();
        await manager.insert(TenantOrmEntity, { id: user.id, planId: free.id });
        await manager.insert(TenantBillingOrmEntity, {
          tenantId: user.id,
          billingEmail: user.email,
          currentPeriodStart: new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
          ),
          currentPeriodEnd: new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth() + 1,
              0,
              23,
              59,
              59,
            ),
          ),
        });
        await manager.insert(TenantMembershipOrmEntity, {
          tenantId: user.id,
          authUserId: user.id,
          role: 'admin',
          permissions: permissionsForTenantRole('admin'),
          isActive: true,
        });
      });
    });
  }
}
