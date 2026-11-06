import { CursorPage, CursorQuery } from '@/shared/http/pagination';
import { WebhookConfig } from './webhook-config';

export abstract class IWebhookConfigRepository {
  abstract listPage(
    tenantId: string,
    options: CursorQuery,
    keyEnvironment?: 'test' | 'live',
  ): Promise<CursorPage<WebhookConfig>>;
  abstract findByTenantId(tenantId: string): Promise<WebhookConfig[]>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<WebhookConfig | null>;
  abstract findByTenantIdAndEvent(
    tenantId: string,
    event: string,
    environment: 'test' | 'live',
  ): Promise<WebhookConfig[]>;
  abstract save(
    webhook: WebhookConfig,
    tenantId: string,
  ): Promise<WebhookConfig>;
  abstract remove(webhook: WebhookConfig, tenantId: string): Promise<void>;
}
