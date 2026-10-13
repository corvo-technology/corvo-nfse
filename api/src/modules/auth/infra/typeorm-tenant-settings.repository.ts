import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { assertTenantOwnership } from '@/infra/persistence/typeorm/tenant-scope';
import { requireTenantId } from '@/infra/persistence/typeorm/tenant-scope';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ITenantSettingsRepository } from '../domain/tenant-settings.repository';
import { TenantSettings } from '../domain/tenant-settings';
import { TenantSettingsOrmEntity } from './tenant-settings.orm-entity';

@Injectable()
export class TypeormTenantSettingsRepository implements ITenantSettingsRepository {
  constructor(
    @InjectRepository(TenantSettingsOrmEntity)
    private readonly repo: Repository<TenantSettingsOrmEntity>,
  ) {}

  private toDomain(entity: TenantSettingsOrmEntity): TenantSettings {
    // business_days may come back as a string (simple-array format) or
    // as a real number[] (int[] format). Normalize both.
    const rawDays = entity.businessDays as unknown;
    const businessDays = Array.isArray(rawDays)
      ? (rawDays as number[])
      : typeof rawDays === 'string'
        ? rawDays
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n))
        : [];

    return {
      id: entity.id,
      tenantId: entity.tenantId,
      timezone: entity.timezone,
      businessHoursStart: entity.businessHoursStart,
      businessHoursEnd: entity.businessHoursEnd,
      businessDays,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async findByTenantId(tenantId: string): Promise<TenantSettings | null> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const entity = await this.repo.findOne({ where: { tenantId } });
      return entity ? this.toDomain(entity) : null;
    });
  }

  async save(
    settings: TenantSettings,
    tenantId: string,
  ): Promise<TenantSettings> {
    return runWithTenant(tenantId, async () => {
      // Use .insert() (not .save()) — avoids the SubjectDatabaseEntityLoader
      // preload that triggers `WHERE id = ''` on no-id entities. This
      // path is hit during the message-send flow when a tenant has no
      // tenant_settings row yet (TenantSettingsService.getSettings).
      assertTenantOwnership(tenantId, settings.tenantId);
      const entity = this.repo.create(settings);
      await this.repo.insert(entity);
      return this.toDomain(entity);
    });
  }

  async update(
    id: string,
    tenantId: string,
    fields: Partial<Omit<TenantSettings, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<void> {
    return runWithTenant(tenantId, async () => {
      requireTenantId(tenantId);
      const {
        timezone,
        businessHoursStart,
        businessHoursEnd,
        businessDays,
        updatedAt,
      } = fields;
      await this.repo.update(
        { id, tenantId },
        {
          timezone,
          businessHoursStart,
          businessHoursEnd,
          businessDays,
          updatedAt,
        },
      );
    });
  }
}
