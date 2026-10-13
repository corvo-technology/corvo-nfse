import { TenantWorkDiscovery } from './tenant-work-discovery';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnitOfWorkPort } from '@/infra/transactions/unit-of-work.port';
import { IAuthAuditEventRepository } from '@/modules/auth/domain/auth-audit-event.repository';
import { IAuthSessionRepository } from '@/modules/auth/domain/auth-session.repository';
import { IAuthUserRepository } from '@/modules/auth/domain/auth-user.repository';
import { IOAuthAuthorizationCodeRepository } from '@/modules/auth/domain/oauth-authorization-code.repository';
import { IOAuthClientRepository } from '@/modules/auth/domain/oauth-client.repository';
import { IWebhookEventRepository } from '@/modules/webhooks-config/domain/webhook-event.repository';
import { ITenantMembershipRepository } from '@/modules/auth/domain/tenant-membership.repository';
import { ITenantInvitationRepository } from '@/modules/auth/domain/tenant-invitation.repository';
import { AUTH_ORM_ENTITIES } from './entities/auth.orm-entities';
import { WebhookEventOrmEntity } from './entities/webhook-event.orm-entity';
import { TenantMembershipOrmEntity } from './entities/tenant-membership.orm-entity';
import { TenantInvitationOrmEntity } from './entities/tenant-invitation.orm-entity';
import {
  TypeOrmAuthAuditEventRepository,
  TypeOrmAuthSessionRepository,
  TypeOrmAuthUserRepository,
  TypeOrmOAuthAuthorizationCodeRepository,
  TypeOrmOAuthClientRepository,
} from './repositories/auth.repositories';
import { TypeOrmWebhookEventRepository } from './repositories/webhook-event.repository';
import { TypeOrmTenantMembershipRepository } from './repositories/tenant-membership.repository';
import { TypeOrmTenantInvitationRepository } from './repositories/tenant-invitation.repository';
import { TypeOrmRepositoryHelper } from './typeorm-repository.helper';
import { TypeOrmTransactionContext } from './typeorm-transaction-context';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work';
import { ApplicationEventsModule } from '@/shared/events/application-events.module';

@Global()
@Module({
  imports: [
    ApplicationEventsModule,
    TypeOrmModule.forFeature([
      ...AUTH_ORM_ENTITIES,
      WebhookEventOrmEntity,
      TenantMembershipOrmEntity,
      TenantInvitationOrmEntity,
    ]),
  ],
  providers: [
    TenantWorkDiscovery,
    TypeOrmRepositoryHelper,
    TypeOrmTransactionContext,
    TypeOrmUnitOfWork,
    TypeOrmAuthUserRepository,
    TypeOrmAuthSessionRepository,
    TypeOrmOAuthClientRepository,
    TypeOrmOAuthAuthorizationCodeRepository,
    TypeOrmAuthAuditEventRepository,
    TypeOrmWebhookEventRepository,
    TypeOrmTenantMembershipRepository,
    {
      provide: ITenantMembershipRepository,
      useExisting: TypeOrmTenantMembershipRepository,
    },
    TypeOrmTenantInvitationRepository,
    {
      provide: ITenantInvitationRepository,
      useExisting: TypeOrmTenantInvitationRepository,
    },
    { provide: UnitOfWorkPort, useExisting: TypeOrmUnitOfWork },
    { provide: IAuthUserRepository, useExisting: TypeOrmAuthUserRepository },
    {
      provide: IAuthSessionRepository,
      useExisting: TypeOrmAuthSessionRepository,
    },
    {
      provide: IOAuthClientRepository,
      useExisting: TypeOrmOAuthClientRepository,
    },
    {
      provide: IOAuthAuthorizationCodeRepository,
      useExisting: TypeOrmOAuthAuthorizationCodeRepository,
    },
    {
      provide: IAuthAuditEventRepository,
      useExisting: TypeOrmAuthAuditEventRepository,
    },
    {
      provide: IWebhookEventRepository,
      useExisting: TypeOrmWebhookEventRepository,
    },
  ],
  exports: [
    TenantWorkDiscovery,
    TypeOrmRepositoryHelper,
    TypeOrmTransactionContext,
    TypeOrmUnitOfWork,
    UnitOfWorkPort,
    IAuthUserRepository,
    IAuthSessionRepository,
    IOAuthClientRepository,
    IOAuthAuthorizationCodeRepository,
    IAuthAuditEventRepository,
    IWebhookEventRepository,
    ITenantMembershipRepository,
    ITenantInvitationRepository,
  ],
})
export class TypeOrmPersistenceModule {}
