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
      tokenHash: entity.tokenHash ?? undefined,
      invitedByUserId: entity.invitedByUserId ?? undefined,
      acceptedAt: entity.acceptedAt ?? undefined,
      acceptedByUserId: entity.acceptedByUserId ?? undefined,
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

  async listOpenByTenant(tenantId: string): Promise<TenantInvitation[]> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entities = await this.db
        .repository(TenantInvitationOrmEntity)
        .createQueryBuilder('invitation')
        .where('invitation.tenantId = :tenantId', { tenantId })
        .andWhere("invitation.status = 'pending'")
        .andWhere('invitation.expiresAt > now()')
        .orderBy('invitation.createdAt', 'DESC')
        .getMany();
      return entities.map((entity) => this.toDomain(entity));
    });
  }

  async findByTokenHash(tokenHash: string): Promise<TenantInvitation | null> {
    const entity = await this.db
      .repository(TenantInvitationOrmEntity)
      .findOne({ where: { tokenHash } });
    return entity ? this.toDomain(entity) : null;
  }

  async claim(id: string, userId: string, now: Date): Promise<boolean> {
    const result = await this.db
      .repository(TenantInvitationOrmEntity)
      .createQueryBuilder()
      .update()
      .set({
        status: 'completed',
        acceptedAt: now,
        acceptedByUserId: userId,
        tokenHash: null,
      })
      .where("id = :id AND status = 'pending' AND expires_at > :now", {
        id,
        now,
      })
      .execute();
    return (result.affected ?? 0) === 1;
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
