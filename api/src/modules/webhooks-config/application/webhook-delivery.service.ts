import { WebhookDeliveryQuery } from '@/shared/http/webhook-delivery-query';
import { Injectable } from '@nestjs/common';
import { IWebhookDeliveryRepository } from '../domain/webhook-delivery.repository';
import { WebhookDelivery } from '../domain/webhook-delivery';

@Injectable()
export class WebhookDeliveryService {
  listPage(tenantId: string, options: WebhookDeliveryQuery) {
    return this.repo.listPage(tenantId, options);
  }

  constructor(private readonly repo: IWebhookDeliveryRepository) {}

  async findAll(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      hours?: number;
      environment?: WebhookDelivery['environment'];
    },
  ): Promise<WebhookDelivery[]> {
    const since = options?.hours
      ? new Date(Date.now() - options.hours * 60 * 60 * 1000)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24h
    return this.repo.findByTenantId(tenantId, { ...options, since });
  }

  async getStats(
    tenantId: string,
    hours: number = 24,
    environment?: WebhookDelivery['environment'],
  ): Promise<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    delayed: number;
  }> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.repo.getStats(tenantId, since, environment);
  }
}
