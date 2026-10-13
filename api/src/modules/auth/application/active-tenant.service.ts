import { Inject, Injectable } from '@nestjs/common';
import { TenantAccessDeniedError } from '../domain/errors';
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import {
  SensitiveAuthActor,
  SensitiveAuthAuditService,
} from './sensitive-auth-audit.service';

@Injectable()
export class ActiveTenantService {
  constructor(
    @Inject(ITenantMembershipRepository)
    private readonly membershipRepository: ITenantMembershipRepository,
    private readonly auditService: SensitiveAuthAuditService,
  ) {}

  async switchTenant(
    actor: SensitiveAuthActor,
    tenantId: string,
    productKey: string,
  ): Promise<void> {
    const membership =
      await this.membershipRepository.findByAuthUserTenantAndProduct(
        actor.authUserId,
        tenantId,
        productKey,
      );
    if (!membership?.isActive) {
      throw new TenantAccessDeniedError();
    }
    await this.auditService.record({
      actor: { ...actor, membershipId: membership.id },
      tenantId,
      action: 'auth.active_tenant_changed',
      targetType: 'tenant',
      targetId: tenantId,
    });
  }
}
