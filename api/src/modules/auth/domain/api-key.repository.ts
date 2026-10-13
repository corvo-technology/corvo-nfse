import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { ApiKey } from './api-key';

export abstract class IApiKeyRepository {
  abstract listPage(
    tenantId: string,
    options: CursorQuery,
  ): Promise<CursorPage<ApiKey>>;
  abstract findByKeyPrefix(prefix: string): Promise<ApiKey | null>;
  abstract findByTenantId(tenantId: string): Promise<ApiKey[]>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<ApiKey | null>;
  abstract save(apiKey: ApiKey, tenantId: string): Promise<ApiKey>;
  abstract remove(apiKey: ApiKey, tenantId: string): Promise<void>;
}
