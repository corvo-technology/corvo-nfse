import { TenantSettings } from './tenant-settings';

export abstract class ITenantSettingsRepository {
  abstract findByTenantId(tenantId: string): Promise<TenantSettings | null>;
  abstract save(
    settings: TenantSettings,
    tenantId: string,
  ): Promise<TenantSettings>;
  abstract update(
    id: string,
    tenantId: string,
    fields: Partial<Omit<TenantSettings, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<void>;
}
