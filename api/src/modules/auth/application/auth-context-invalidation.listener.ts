import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ITenantMembershipRepository } from '../domain/tenant-membership.repository';
import { AuthContextCacheService } from './auth-context-cache.service';
import {
  AUTHORIZATION_CONTEXT_CHANGED,
  AUTHORIZATION_TENANT_METADATA_CHANGED,
} from './authorization.events';
import type {
  AuthorizationContextChangedEvent,
  AuthorizationTenantMetadataChangedEvent,
} from './authorization.events';

@Injectable()
export class AuthContextInvalidationListener {
  constructor(
    private readonly cache: AuthContextCacheService,
    @Inject(ITenantMembershipRepository)
    private readonly memberships: ITenantMembershipRepository,
  ) {}

  @OnEvent(AUTHORIZATION_CONTEXT_CHANGED)
  onContextChanged(event: AuthorizationContextChangedEvent): Promise<void> {
    return this.cache.invalidateUser(event.authUserId);
  }

  @OnEvent(AUTHORIZATION_TENANT_METADATA_CHANGED)
  async onTenantMetadataChanged(
    event: AuthorizationTenantMetadataChangedEvent,
  ): Promise<void> {
    const memberships = await this.memberships.listByTenant(event.tenantId);
    await this.cache.invalidateTenantUsers(
      memberships.map((membership) => membership.authUserId),
    );
  }
}
