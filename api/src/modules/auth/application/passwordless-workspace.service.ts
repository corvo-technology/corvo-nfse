import { runAsSystem } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DEPLOYMENT_MODE, type DeploymentMode } from '@/shared/deployment-mode';
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
    @Optional()
    @Inject(DEPLOYMENT_MODE)
    private readonly mode: DeploymentMode = 'cloud',
  ) {}

  async ensureWorkspace(user: AuthUser): Promise<void> {
    return runAsSystem('workspace-bootstrap', async () => {
      await this.unitOfWork.execute(async () => {
        // Serialize first login for this account, including simultaneous challenges.
        await this.workspaces.lockUser(user.id);
        const memberships = await this.workspaces.memberships(user.id);
        // The user's own workspace uses their id as tenant id. A membership in
        // someone else's tenant (an invite) must neither replace it nor block it.
        const own = memberships.find(
          (membership) => membership.tenantId === user.id,
        );
        if (own?.isActive) return;
        if (own)
          throw new ForbiddenException({
            code: 'MEMBERSHIP_INACTIVE',
            message: 'Tenant membership is inactive',
          });

        // A self-hosted instance has no Free plan and no welcome notes to give.
        const selfHosted = this.mode === 'self_hosted';
        const planId = selfHosted
          ? await this.workspaces.selfHostedPlanId()
          : await this.workspaces.freePlanId();
        const grantWelcomeNotes =
          !selfHosted &&
          (await this.workspaces.claimWelcomeNotes(
            normalizeEmailKey(user.email),
            user.id,
          ));

        const now = new Date();
        await this.workspaces.create({
          tenantId: user.id,
          authUserId: user.id,
          planId,
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
          grantWelcomeNotes,
        });
      });
    });
  }
}
