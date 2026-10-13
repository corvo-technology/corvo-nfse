import { CursorPage } from '@/shared/http/pagination';
import { WebhookDeliveryQuery } from '@/shared/http/webhook-delivery-query';
import { WebhookDelivery } from './webhook-delivery';

export abstract class IWebhookDeliveryRepository {
  abstract listPage(
    tenantId: string,
    options: WebhookDeliveryQuery,
  ): Promise<CursorPage<WebhookDelivery>>;
  abstract getStats(
    tenantId: string,
    since: Date,
    environment?: WebhookDelivery['environment'],
  ): Promise<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    delayed: number;
  }>;

  abstract findByTenantId(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      since?: Date;
      environment?: WebhookDelivery['environment'];
    },
  ): Promise<WebhookDelivery[]>;
  abstract save(
    delivery: WebhookDelivery,
    tenantId: string,
  ): Promise<WebhookDelivery>;
  abstract count(tenantId: string, since: Date): Promise<number>;
  abstract findByIdAndTenantId(
    id: string,
    tenantId: string,
  ): Promise<WebhookDelivery | null>;
  abstract findPendingDeliveries(
    tenantId: string,
    now: Date,
  ): Promise<WebhookDelivery[]>;
  /**
   * Atomically leases a due delivery by pushing `nextRetryAt` to `leaseUntil`.
   * Returns false when another runtime already claimed it.
   */
  abstract claimDelivery(
    id: string,
    tenantId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean>;
  abstract update(
    id: string,
    tenantId: string,
    fields: Partial<
      Pick<
        WebhookDelivery,
        | 'status'
        | 'retryCount'
        | 'nextRetryAt'
        | 'lastError'
        | 'durationMs'
        | 'statusCode'
        | 'responseBody'
        | 'errorMessage'
      >
    >,
  ): Promise<void>;
}
