import { CursorQuery } from '@/shared/http/pagination';
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { WebhookConfig, webhookVisibleTo } from '../domain/webhook-config';
import { IWebhookConfigRepository } from '../domain/webhook-config.repository';
import { WebhookNotFoundError, WebhookValidationError } from '../domain/errors';
import { PUBLIC_WEBHOOK_EVENT_TYPES } from '../domain/webhook-event';
import { assertNotPrivateHost } from './url-safety.validator';

@Injectable()
export class WebhookConfigService {
  listPage(
    tenantId: string,
    options: CursorQuery,
    keyEnvironment?: 'test' | 'live',
  ) {
    return this.repo.listPage(tenantId, options, keyEnvironment);
  }

  constructor(private readonly repo: IWebhookConfigRepository) {}

  async findAll(tenantId: string): Promise<WebhookConfig[]> {
    return this.repo.findByTenantId(tenantId);
  }

  async findOne(
    tenantId: string,
    id: string,
    keyEnvironment?: 'test' | 'live',
  ): Promise<WebhookConfig> {
    const webhook = await this.repo.findByIdAndTenantId(id, tenantId);
    if (!webhook || !webhookVisibleTo(webhook, keyEnvironment))
      throw new WebhookNotFoundError(id);
    return webhook;
  }

  async create(
    tenantId: string,
    data: { url: string; events: string[] },
    keyEnvironment?: 'test' | 'live',
  ): Promise<WebhookConfig> {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(data.url);
    } catch {
      throw new WebhookValidationError('Invalid URL', { url: data.url });
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new WebhookValidationError('URL must use http or https protocol', {
        url: data.url,
      });
    }

    // SSRF protection: block private/loopback/link-local IPs (RFC1918 + IPv6 ULA)
    await assertNotPrivateHost(parsedUrl);

    // Validate events
    if (
      !data.events ||
      !Array.isArray(data.events) ||
      data.events.length === 0
    ) {
      throw new WebhookValidationError('At least one event type is required');
    }
    const invalidEvents = data.events.filter(
      (e) => !(PUBLIC_WEBHOOK_EVENT_TYPES as readonly string[]).includes(e),
    );
    if (invalidEvents.length > 0) {
      throw new WebhookValidationError(
        `Invalid event types: ${invalidEvents.join(', ')}`,
        {
          events: invalidEvents.join(', '),
        },
      );
    }

    const secret = randomBytes(32).toString('hex');
    const now = new Date();
    const webhook: WebhookConfig = {
      id: crypto.randomUUID(),
      tenantId,
      url: data.url,
      events: data.events,
      secret,
      environment: keyEnvironment ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    return this.repo.save(webhook, tenantId);
  }

  async remove(
    tenantId: string,
    id: string,
    keyEnvironment?: 'test' | 'live',
  ): Promise<void> {
    const webhook = await this.findOne(tenantId, id, keyEnvironment);
    await this.repo.remove(webhook, tenantId);
  }

  async findByEvent(
    tenantId: string,
    event: string,
    environment: 'test' | 'live',
  ): Promise<WebhookConfig[]> {
    return this.repo.findByTenantIdAndEvent(tenantId, event, environment);
  }
}
