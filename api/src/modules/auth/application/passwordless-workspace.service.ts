import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { IWorkspaceRepository } from '../domain/workspace.repository';
import type { AuthUser } from '../domain/auth-user';
import { permissionsForTenantRole } from '../domain/permission';
import { normalizeEmailKey } from '../domain/email-key';

@Injectable()
export class PasswordlessWorkspaceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly workspaces: IWorkspaceRepository,
  ) {}

  async ensureWorkspace(user: AuthUser): Promise<void> {
    return runAsSystem('workspace-bootstrap', async () => {
      await this.unitOfWork.execute(async () => {
        // Serialize first login for this account, including simultaneous challenges.
        await this.workspaces.lockUser(user.id);
        const memberships = await this.workspaces.memberships(user.id);
        if (memberships.some((membership) => membership.isActive)) return;
        if (memberships.length)
          throw new ForbiddenException('Tenant membership is inactive');

        const freePlanId = await this.workspaces.freePlanId();
        const grantFirstFreeNote = await this.workspaces.claimFirstFreeNote(
          normalizeEmailKey(user.email),
          user.id,
        );

        const now = new Date();
        await this.workspaces.create({
          tenantId: user.id,
          authUserId: user.id,
          planId: freePlanId,
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

          role: 'admin',
          permissions: permissionsForTenantRole('admin'),
          grantFirstFreeNote,
        });
      });
    });
  }
}
