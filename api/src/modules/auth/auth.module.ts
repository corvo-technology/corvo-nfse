import {
  DEPLOYMENT_MODE,
  deploymentModeFromEnv,
} from '@/shared/deployment-mode';
import { IWorkspaceRepository } from './domain/workspace.repository';
import { TypeOrmWorkspaceRepository } from './infra/typeorm-workspace.repository';
import { HttpApiRateLimitGuard } from '@/shared/http/rate-limit.guard';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '@/infra/config/config.module';
import { ActiveTenantService } from './application/active-tenant.service';
import { ApiKeyService } from './application/api-key.service';
import { AuthContextService } from './application/auth-context.service';
import { AuthController } from './http/auth.controller';
import { AuthUserService } from './application/auth-user.service';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TypeOrmTenantRepository } from './infra/typeorm-tenant.repository';
import { InvitationService } from './application/invitation.service';
import { InviteMemberService } from './application/invite-member.service';
import { MembershipService } from './application/membership.service';
import { RoutePermissionService } from './application/route-permission.service';
import { SensitiveAuthAuditService } from './application/sensitive-auth-audit.service';
import { TenantSettingsService } from './application/tenant-settings.service';
import { IApiKeyRepository } from './domain/api-key.repository';
import { ITenantSettingsRepository } from './domain/tenant-settings.repository';
import { ApiKeyOrmEntity } from './infra/api-key.orm-entity';
import { TenantSettingsOrmEntity } from './infra/tenant-settings.orm-entity';
import { TypeormApiKeyRepository } from './infra/typeorm-api-key.repository';
import { TypeormTenantSettingsRepository } from './infra/typeorm-tenant-settings.repository';
import { ApiKeyGuard } from './api-key.guard';
import { PermissionGuard } from './permission.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { ApplicationEventsModule } from '@/shared/events/application-events.module';
import { SecurityModule } from '@/modules/security/security.module';
import { TurnstileProofGuard } from '@/modules/security/http/turnstile-proof.guard';
import { AuthContextCacheService } from './application/auth-context-cache.service';
import { AuthContextInvalidationListener } from './application/auth-context-invalidation.listener';
import { CookieAuthGuard } from './application/cookie-auth.guard';
import { CookiePolicyService } from './application/cookie-policy.service';
import { CookieSessionService } from './application/cookie-session.service';
import { CsrfGuard } from './application/csrf.guard';
import { CsrfService } from './application/csrf.service';
import { SessionController } from './http/session.controller';
import { AuthIdentityOrmEntity } from './infra/auth-identity.orm-entity';
import { AUTH_IDENTITY_REPOSITORY } from './domain/auth-identity.repository';
import { TypeOrmAuthIdentityRepository } from './infra/typeorm-auth-identity.repository';
import { MagicLinkService } from './application/magic-link.service';
import { AuthIdentityService } from './application/auth-identity.service';
import { MagicLinkController } from './http/magic-link.controller';
import { OAuthController } from './http/oauth.controller';
import { OtpModule } from '@/modules/security/otp/otp.module';
import { EmailModule } from '@/modules/email/email.module';
import { ApiKeyController } from './application/api-key.controller';
import { PasswordlessWorkspaceService } from './application/passwordless-workspace.service';
import { AuthOauthModule } from './auth-oauth.module';
import { PlatformAdminPolicy } from './application/platform-admin.policy';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiKeyOrmEntity,
      TenantSettingsOrmEntity,
      AuthIdentityOrmEntity,
      TenantOrmEntity,
    ]),
    AppConfigModule,
    ApplicationEventsModule,
    SecurityModule,
    OtpModule,
    EmailModule,
    AuthOauthModule,
  ],
  controllers: [
    AuthController,
    SessionController,
    MagicLinkController,
    OAuthController,
    ApiKeyController,
  ],
  providers: [
    ActiveTenantService,
    ApiKeyService,
    AuthContextService,
    AuthContextCacheService,
    AuthContextInvalidationListener,
    AuthUserService,
    TypeOrmTenantRepository,
    CookieAuthGuard,
    CookiePolicyService,
    CookieSessionService,
    CsrfGuard,
    CsrfService,
    InvitationService,
    InviteMemberService,
    ApiKeyGuard,
    MembershipService,
    PermissionGuard,
    RoutePermissionService,
    SensitiveAuthAuditService,
    PlatformAdminPolicy,
    TenantContextGuard,
    TypeormApiKeyRepository,
    {
      provide: IApiKeyRepository,
      useExisting: TypeormApiKeyRepository,
    },
    TypeormTenantSettingsRepository,
    {
      provide: ITenantSettingsRepository,
      useExisting: TypeormTenantSettingsRepository,
    },
    TenantSettingsService,
    TurnstileProofGuard,
    // NEW: identity & magic-link providers
    MagicLinkService,
    PasswordlessWorkspaceService,
    { provide: DEPLOYMENT_MODE, useValue: deploymentModeFromEnv() },
    { provide: IWorkspaceRepository, useClass: TypeOrmWorkspaceRepository },
    AuthIdentityService,
    TypeOrmAuthIdentityRepository,
    {
      provide: AUTH_IDENTITY_REPOSITORY,
      useExisting: TypeOrmAuthIdentityRepository,
    },
    // TODO (Phase 6 follow-up): add SocialAuthService once recovered from git
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useExisting: CookieAuthGuard,
    },
    { provide: APP_GUARD, useClass: HttpApiRateLimitGuard },
    {
      provide: APP_GUARD,
      useClass: TenantContextGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TurnstileProofGuard,
    },
  ],
  exports: [
    CookiePolicyService,
    ActiveTenantService,
    ApiKeyGuard,
    ApiKeyService,
    AuthContextService,
    AuthUserService,
    AuthIdentityService,
    AUTH_IDENTITY_REPOSITORY,
    CookieSessionService,
    InvitationService,
    InviteMemberService,
    MembershipService,
    PermissionGuard,
    RoutePermissionService,
    SensitiveAuthAuditService,
    PlatformAdminPolicy,
    TenantSettingsService,
    TenantContextGuard,
    TypeOrmTenantRepository,
  ],
})
export class AuthModule {}
