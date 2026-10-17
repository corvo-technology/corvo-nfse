import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { TenantMembershipOrmEntity } from '../entities/tenant-membership.orm-entity';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuthAuditEvent } from '@/modules/auth/domain/auth-audit-event';
import { IAuthAuditEventRepository } from '@/modules/auth/domain/auth-audit-event.repository';
import { AuthSession } from '@/modules/auth/domain/auth-session';
import { IAuthSessionRepository } from '@/modules/auth/domain/auth-session.repository';
import { AuthUser } from '@/modules/auth/domain/auth-user';
import { IAuthUserRepository } from '@/modules/auth/domain/auth-user.repository';
import { OAuthAuthorizationCode } from '@/modules/auth/domain/oauth-authorization-code';
import { IOAuthAuthorizationCodeRepository } from '@/modules/auth/domain/oauth-authorization-code.repository';
import { OAuthClient } from '@/modules/auth/domain/oauth-client';
import { IOAuthClientRepository } from '@/modules/auth/domain/oauth-client.repository';
import {
  AuthAuditEventOrmEntity,
  AuthAuthorizationCodeOrmEntity,
  AuthOAuthClientOrmEntity,
  AuthSessionOrmEntity,
  AuthUserOrmEntity,
} from '../entities/auth.orm-entities';
import { TypeOrmRepositoryHelper } from '../typeorm-repository.helper';

@Injectable()
export class TypeOrmAuthUserRepository implements IAuthUserRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  async findById(id: string): Promise<AuthUser | null> {
    const row = await this.db
      .repository(AuthUserOrmEntity)
      .findOne({ where: { id } });
    return row ? toAuthUser(row) : null;
  }

  async findByIdsAndTenantId(
    ids: string[],
    tenantId: string,
  ): Promise<AuthUser[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      if (ids.length === 0) return [];
      const rows = await this.db
        .repository(AuthUserOrmEntity)
        .createQueryBuilder('user')
        .innerJoin(
          TenantMembershipOrmEntity,
          'membership',
          'membership.auth_user_id = user.id AND membership.tenant_id = :tenantId',
          { tenantId },
        )
        .where('user.id IN (:...ids)', { ids })
        .getMany();
      return rows.map(toAuthUser);
    });
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const row = await this.db.repository(AuthUserOrmEntity).findOne({
      where: { email: email.trim().toLowerCase() },
    });
    return row ? toAuthUser(row) : null;
  }

  async lockById(id: string): Promise<AuthUser | null> {
    const row = await this.db
      .repository(AuthUserOrmEntity)
      .createQueryBuilder('auth_user')
      .setLock('pessimistic_write')
      .where('auth_user.id = :id', { id })
      .getOne();
    return row ? toAuthUser(row) : null;
  }

  async insertIfEmailAbsent(user: AuthUser): Promise<AuthUser | null> {
    const result = await this.db
      .repository(AuthUserOrmEntity)
      .createQueryBuilder()
      .insert()
      .into(AuthUserOrmEntity)
      .values(toAuthUserRow(user))
      .orIgnore()
      .returning('*')
      .execute();
    const row = (result.raw as AuthUserOrmEntity[])[0];
    return row ? toAuthUser(row) : null;
  }

  async save(user: AuthUser): Promise<AuthUser> {
    const saved = await this.db
      .repository(AuthUserOrmEntity)
      .save(toAuthUserRow(user));
    return toAuthUser(saved);
  }

  update(user: AuthUser): Promise<AuthUser> {
    return this.save(user);
  }

  async updateLastLoginAt(
    authUserId: string,
    lastLoginAt: Date,
  ): Promise<void> {
    await this.db.repository(AuthUserOrmEntity).update(authUserId, {
      updatedAt: lastLoginAt,
    });
  }
}

@Injectable()
export class TypeOrmAuthSessionRepository implements IAuthSessionRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  async rotateRefreshToken(
    id: string,
    tenantId: string,
    authUserId: string,
    clientId: string,
    previousHash: string,
    nextHash: string,
    now = new Date(),
  ): Promise<boolean> {
    requireTenantId(tenantId);
    const result = await this.repository().update(
      {
        id,
        activeTenantId: tenantId,
        authUserId,
        clientId,
        kind: 'oauth_refresh',
        revokedAt: IsNull(),
        refreshTokenHash: previousHash,
        expiresAt: MoreThan(now),
      },
      { refreshTokenHash: nextHash },
    );
    return result.affected === 1;
  }

  async revokeOAuthSession(
    id: string,
    tenantId: string,
    authUserId: string,
    clientId: string,
  ): Promise<void> {
    requireTenantId(tenantId);
    await this.repository().update(
      {
        id,
        activeTenantId: tenantId,
        authUserId,
        clientId,
        kind: 'oauth_refresh',
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
  }

  async revokeTenantSession(
    id: string,
    tenantId: string,
    authUserId: string,
  ): Promise<void> {
    requireTenantId(tenantId);
    await this.repository().update(
      { id, activeTenantId: tenantId, authUserId, kind: 'oauth_refresh' },
      { revokedAt: new Date(), updatedAt: new Date() },
    );
  }

  private repository(): Repository<AuthSessionOrmEntity> {
    return this.db.repository(AuthSessionOrmEntity);
  }

  async findById(id: string): Promise<AuthSession | null> {
    const row = await this.repository().findOne({ where: { id } });
    return row ? toAuthSession(row) : null;
  }

  async findActiveById(
    id: string,
    now = new Date(),
  ): Promise<AuthSession | null> {
    const row = await this.repository().findOne({
      where: {
        id,
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    return toAuthSession(row);
  }

  async findActiveByRefreshTokenHash(
    refreshTokenHash: string,
    now = new Date(),
  ): Promise<AuthSession | null> {
    const row = await this.repository().findOne({
      where: {
        refreshTokenHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
    if (!row || row.revokedAt || row.expiresAt <= now) return null;
    return toAuthSession(row);
  }

  async findActiveBySessionTokenHash(
    sessionTokenHash: string,
    now = new Date(),
  ): Promise<AuthSession | null> {
    const row = await this.repository().findOne({
      where: {
        kind: 'web',
        sessionTokenHash,
        revokedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
    return row ? toAuthSession(row) : null;
  }

  async revokeAllForUser(
    authUserId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const now = new Date();
    const qb = this.repository()
      .createQueryBuilder()
      .update(AuthSessionOrmEntity)
      .set({ revokedAt: now, updatedAt: now })
      .where('auth_user_id = :authUserId', { authUserId })
      .andWhere('revoked_at IS NULL');
    if (exceptSessionId) {
      qb.andWhere('id <> :exceptSessionId', { exceptSessionId });
    }
    const result = await qb.execute();
    return result.affected ?? 0;
  }

  async save(session: AuthSession): Promise<AuthSession> {
    const saved = await this.repository().save(toAuthSessionRow(session));
    return toAuthSession(saved);
  }

  update(session: AuthSession): Promise<AuthSession> {
    return this.save(session);
  }
}

@Injectable()
export class TypeOrmOAuthClientRepository implements IOAuthClientRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get repository(): Repository<AuthOAuthClientOrmEntity> {
    return this.db.repository(AuthOAuthClientOrmEntity);
  }

  async findById(id: string): Promise<OAuthClient | null> {
    const row = await this.repository.findOne({ where: { id } });
    return row ? toOAuthClient(row) : null;
  }

  async save(client: OAuthClient): Promise<OAuthClient> {
    const saved = await this.repository.save(toOAuthClientRow(client));
    return toOAuthClient(saved);
  }
}

@Injectable()
export class TypeOrmOAuthAuthorizationCodeRepository implements IOAuthAuthorizationCodeRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private get repository(): Repository<AuthAuthorizationCodeOrmEntity> {
    return this.db.repository(AuthAuthorizationCodeOrmEntity);
  }

  async consume(
    id: string,
    authUserId: string,
    tenantId: string,
    now = new Date(),
  ): Promise<boolean> {
    requireTenantId(tenantId);
    const result = await this.repository.update(
      {
        id,
        authUserId,
        tenantId,
        consumedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
      { consumedAt: now },
    );
    return result.affected === 1;
  }

  async findActiveByCodeHash(
    codeHash: string,
    now = new Date(),
  ): Promise<OAuthAuthorizationCode | null> {
    const row = await this.repository.findOne({
      where: {
        codeHash,
        expiresAt: MoreThan(now),
      },
    });
    if (!row || row.consumedAt || row.expiresAt <= now) return null;
    return toAuthorizationCode(row);
  }

  async save(code: OAuthAuthorizationCode): Promise<OAuthAuthorizationCode> {
    const saved = await this.repository.save(toAuthorizationCodeRow(code));
    return toAuthorizationCode(saved);
  }

  update(code: OAuthAuthorizationCode): Promise<OAuthAuthorizationCode> {
    return this.save(code);
  }
}

@Injectable()
export class TypeOrmAuthAuditEventRepository implements IAuthAuditEventRepository {
  constructor(
    @InjectRepository(AuthAuditEventOrmEntity)
    private readonly repository: Repository<AuthAuditEventOrmEntity>,
  ) {}

  async save(event: AuthAuditEvent): Promise<AuthAuditEvent> {
    const saved = await this.repository.save(toAuditRow(event));
    return toAuditEvent(saved);
  }
}

function toAuthUser(row: AuthUserOrmEntity): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerifiedAt: row.emailVerifiedAt ?? null,
    primaryIdentityType:
      (row.primaryIdentityType as AuthUser['primaryIdentityType']) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuthUserRow(user: AuthUser): AuthUserOrmEntity {
  return Object.assign(new AuthUserOrmEntity(), user);
}

function toAuthSession(row: AuthSessionOrmEntity): AuthSession {
  return {
    id: row.id,
    authUserId: row.authUserId,
    clientId: row.clientId,
    refreshTokenHash: row.refreshTokenHash,
    kind: row.kind,
    sessionTokenHash: row.sessionTokenHash,
    activeTenantId: row.activeTenantId,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuthSessionRow(session: AuthSession): AuthSessionOrmEntity {
  return Object.assign(new AuthSessionOrmEntity(), session);
}

function toOAuthClient(row: AuthOAuthClientOrmEntity): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    redirectUris: row.redirectUris,
    scopes: row.scopes,
    isFirstParty: row.isFirstParty,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOAuthClientRow(client: OAuthClient): AuthOAuthClientOrmEntity {
  return Object.assign(new AuthOAuthClientOrmEntity(), client);
}

function toAuthorizationCode(
  row: AuthAuthorizationCodeOrmEntity,
): OAuthAuthorizationCode {
  return {
    id: row.id,
    clientId: row.clientId,
    authUserId: row.authUserId,
    productKey: row.productKey,
    tenantId: row.tenantId,
    codeHash: row.codeHash,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: row.codeChallengeMethod as 'S256',
    redirectUri: row.redirectUri,
    scope: row.scope,
    environment: row.environment,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuthorizationCodeRow(
  code: OAuthAuthorizationCode,
): AuthAuthorizationCodeOrmEntity {
  return Object.assign(new AuthAuthorizationCodeOrmEntity(), code);
}

function toAuditEvent(row: AuthAuditEventOrmEntity): AuthAuditEvent {
  return {
    id: row.id,
    authUserId: row.authUserId,
    eventType: row.eventType as AuthAuditEvent['eventType'],
    clientId: row.clientId,
    sessionId: row.sessionId,
    ipHash: row.ipHash,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

function toAuditRow(event: AuthAuditEvent): AuthAuditEventOrmEntity {
  return Object.assign(new AuthAuditEventOrmEntity(), event);
}
