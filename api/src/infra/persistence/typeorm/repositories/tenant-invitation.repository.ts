import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import {
  persistTenantEntity,
  requireTenantId,
} from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { TenantInvitationOrmEntity } from '../entities/tenant-invitation.orm-entity';
import { ITenantInvitationRepository } from '@/modules/auth/domain/tenant-invitation.repository';
import { TenantInvitation } from '@/modules/auth/domain/tenant-invitation';
import { TypeOrmRepositoryHelper } from '../typeorm-repository.helper';

@Injectable()
export class TypeOrmTenantInvitationRepository implements ITenantInvitationRepository {
  constructor(private readonly db: TypeOrmRepositoryHelper) {}

  private toDomain(entity: TenantInvitationOrmEntity): TenantInvitation {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      email: entity.email,
      name: entity.name,
      role: entity.role as TenantInvitation['role'],
      permissions: entity.permissions as TenantInvitation['permissions'],
      status: entity.status as TenantInvitation['status'],
      expiresAt: entity.expiresAt ?? new Date(),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async findPendingByEmailAndTenant(
    email: string,
    tenantId: string,
  ): Promise<TenantInvitation | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.db
        .repository(TenantInvitationOrmEntity)
        .findOne({ where: { email, tenantId, status: 'pending' } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<TenantInvitation | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.db
        .repository(TenantInvitationOrmEntity)
        .findOne({ where: { id, tenantId } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async listByTenant(tenantId: string): Promise<TenantInvitation[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.db
        .repository(TenantInvitationOrmEntity)
        .find({ where: { tenantId } });
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async save(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const repo = this.db.repository(TenantInvitationOrmEntity);
      const entity = await persistTenantEntity(
        repo,
        repo.create(invitation),
        tenantId,
        ['email'],
      );
      return this.toDomain(entity);
    });
  }

  async update(
    invitation: TenantInvitation,
    tenantId: string,
  ): Promise<TenantInvitation> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      return this.save(invitation, tenantId);
    });
  }
}
