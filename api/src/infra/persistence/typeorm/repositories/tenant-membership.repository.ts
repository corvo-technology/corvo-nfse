import { runWithAuthUser } from '@/infra/persistence/typeorm/tenant-context.storage';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { persistTenantEntity } from '@/infra/persistence/typeorm/tenant-scope';
import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { queryCursorPage } from '@/shared/http/keyset-pagination';
import { Injectable } from '@nestjs/common';
import { TenantMembershipOrmEntity } from '../entities/tenant-membership.orm-entity';
import {
  ITenantMembershipRepository,
  TenantMembershipWithEstablishmentName,
} from '@/modules/auth/domain/tenant-membership.repository';
import { TenantMembership } from '@/modules/auth/domain/tenant-membership';
import { TypeOrmRepositoryHelper } from '../typeorm-repository.helper';

@Injectable()
export class TypeOrmTenantMembershipRepository implements ITenantMembershipRepository {
  async listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<TenantMembership>> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return queryCursorPage(
        this.db
          .repository(TenantMembershipOrmEntity)
          .createQueryBuilder('membership')
          .where('membership.tenant_id = :tenantId', { tenantId }),
        options,
        ['memberships', tenantId],
        (entity) => this.toDomain(entity),
      );
    });
  }

  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private toDomain(entity: TenantMembershipOrmEntity): TenantMembership {
    return {
      id: entity.id,
      authUserId: entity.authUserId,
      tenantId: entity.tenantId,
      role: entity.role as TenantMembership['role'],
      permissions: entity.permissions as TenantMembership['permissions'],
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<TenantMembership | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.db
        .repository(TenantMembershipOrmEntity)
        .findOne({ where: { id, tenantId } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async findByAuthUserAndTenant(
    authUserId: string,
    tenantId: string,
  ): Promise<TenantMembership | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.db
        .repository(TenantMembershipOrmEntity)
        .findOne({ where: { authUserId, tenantId } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async listActiveByAuthUser(authUserId: string): Promise<TenantMembership[]> {
    return runWithAuthUser(authUserId, async () => {
      const entities = await this.db
        .repository(TenantMembershipOrmEntity)
        .find({ where: { authUserId, isActive: true } });
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async listActiveByAuthUserAndProduct(
    authUserId: string,
    _productKey: string,
  ): Promise<TenantMembership[]> {
    return runWithAuthUser(authUserId, async () => {
      const entities = await this.db
        .repository(TenantMembershipOrmEntity)
        .find({ where: { authUserId, isActive: true } });
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async listActiveWithEstablishmentByAuthUserAndProduct(
    authUserId: string,
    _productKey: string,
  ): Promise<TenantMembershipWithEstablishmentName[]> {
    return runWithAuthUser(authUserId, async () => {
      const entities = await this.db
        .repository(TenantMembershipOrmEntity)
        .find({ where: { authUserId, isActive: true } });
      return entities.map((e) => ({
        ...this.toDomain(e),
        establishmentName: '',
      }));
    });
  }

  async findByAuthUserTenantAndProduct(
    authUserId: string,
    tenantId: string,
    _productKey: string,
  ): Promise<TenantMembership | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.db
        .repository(TenantMembershipOrmEntity)
        .findOne({ where: { authUserId, tenantId } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async listActiveByTenant(tenantId: string): Promise<TenantMembership[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.db
        .repository(TenantMembershipOrmEntity)
        .find({ where: { tenantId, isActive: true } });
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async listByTenant(tenantId: string): Promise<TenantMembership[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.db
        .repository(TenantMembershipOrmEntity)
        .find({ where: { tenantId } });
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async save(
    membership: TenantMembership,
    tenantId: string,
  ): Promise<TenantMembership> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const repo = this.db.repository(TenantMembershipOrmEntity);
      const entity = repo.create({
        id: membership.id,
        authUserId: membership.authUserId,
        tenantId: membership.tenantId,
        role: membership.role,
        permissions: membership.permissions,
        isActive: membership.isActive,
      });
      const saved = await persistTenantEntity(repo, entity, tenantId, [
        'authUserId',
      ]);
      return this.toDomain(saved);
    });
  }

  async update(
    membership: TenantMembership,
    tenantId: string,
  ): Promise<TenantMembership> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.save(membership, tenantId);
    });
  }
}
