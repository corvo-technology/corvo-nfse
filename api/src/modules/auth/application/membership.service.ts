import { CursorQuery } from '@/shared/http/pagination';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TenantMembership,
  TenantMembershipRole,
} from '../domain/tenant-membership';
import { LastTenantAdminError } from '../domain/errors';
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import { permissionsForTenantRole } from '../domain/permission';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import { authorizationContextChanged } from './authorization.events';

@Injectable()
export class MembershipService {
  listPage(tenantId: string, options: CursorQuery) {
    return this.membershipRepository.listPage(tenantId, options);
  }

  constructor(
    @Inject(ITenantMembershipRepository)
    private readonly membershipRepository: ITenantMembershipRepository,
    private readonly events: ApplicationEventBus,
  ) {}

  async create(input: {
    authUserId: string;
    tenantId: string;
    role: TenantMembershipRole;
  }): Promise<TenantMembership> {
    const now = new Date();
    const membership = await this.membershipRepository.save(
      {
        id: crypto.randomUUID(),
        authUserId: input.authUserId,
        tenantId: input.tenantId,
        role: input.role,
        permissions: permissionsForTenantRole(input.role),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      input.tenantId,
    );
    await this.events.publishAndWait(
      authorizationContextChanged(membership.authUserId),
    );
    return membership;
  }

  async listForTenant(tenantId: string): Promise<TenantMembership[]> {
    return this.membershipRepository.listByTenant(tenantId);
  }

  async update(
    membership: TenantMembership,
    tenantId: string,
  ): Promise<TenantMembership> {
    const current = await this.membershipRepository.findByIdAndTenantId(
      membership.id,
      tenantId,
    );
    if (
      current?.isActive &&
      current.role === 'admin' &&
      (!membership.isActive || membership.role !== 'admin')
    ) {
      const activeAdmins = await this.membershipRepository.listActiveByTenant(
        current.tenantId,
      );
      if (activeAdmins.filter((item) => item.role === 'admin').length <= 1) {
        throw new LastTenantAdminError();
      }
    }

    if (!current) throw new NotFoundException('Member not found');
    const updated = await this.membershipRepository.update(
      {
        ...membership,
        permissions: permissionsForTenantRole(membership.role),
      },
      tenantId,
    );
    await this.events.publishAndWait(
      authorizationContextChanged(updated.authUserId),
    );
    return updated;
  }
}
