import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ITenantSettingsRepository } from '../domain/tenant-settings.repository';
import { TenantSettings } from '../domain/tenant-settings';

@Injectable()
export class TenantSettingsService {
  constructor(private readonly repo: ITenantSettingsRepository) {}

  async getSettings(tenantId: string): Promise<TenantSettings> {
    let settings = await this.repo.findByTenantId(tenantId);
    if (!settings) {
      settings = await this.repo.save(
        {
          id: randomUUID(),
          tenantId,
          timezone: 'UTC',
          businessHoursStart: 9,
          businessHoursEnd: 18,
          businessDays: [1, 2, 3, 4, 5],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        tenantId,
      );
    }
    return settings;
  }

  async updateSettings(
    tenantId: string,
    data: Partial<TenantSettings>,
  ): Promise<TenantSettings> {
    const settings = await this.getSettings(tenantId);
    await this.repo.update(settings.id, tenantId, {
      ...data,
      updatedAt: new Date(),
    });
    return this.getSettings(tenantId);
  }
}
