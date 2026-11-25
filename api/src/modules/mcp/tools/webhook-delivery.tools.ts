import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { WebhookDeliveryService } from '@/modules/webhooks-config/application/webhook-delivery.service';
import type { WebhookOutboxService } from '@/modules/webhooks-config/application/webhook-outbox.service';
import {
  MAX_DELIVERY_HOURS,
  WEBHOOK_DELIVERY_STATUS_FILTERS,
  WebhookDeliveryQuery,
} from '@/shared/http/webhook-delivery-query';
import {
  WebhookDeliveriesListInput,
  WebhookDeliveryRetryInput,
} from '../dto/tool-input.dto';
import { toPublicWebhookDelivery } from './public-shapes';
import { invalidInput } from './tool-input-errors';

export const WEBHOOK_DELIVERIES_LIST_TOOL = {
  name: 'webhook_deliveries_list',
  description: `List the notices (webhooks) Corvo sent to the customer's system, newest first. Use it to answer "did my system get the notice for this invoice?". Each item has the event, the invoice, the status (${WEBHOOK_DELIVERY_STATUS_FILTERS.join(', ')}), the HTTP code the customer's system answered, how many attempts were made, the next attempt and a short error. "failed" means every attempt failed and Corvo stopped; offer webhook_delivery_retry. Never shows the secret, the signature or the event body.`,
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: {
        type: 'string',
        description: 'UUID of an invoice: only notices about it',
      },
      event_type: {
        type: 'string',
        description: 'Only this event, e.g. nfse.invoice.authorized',
      },
      status: {
        type: 'string',
        enum: [...WEBHOOK_DELIVERY_STATUS_FILTERS],
        description: 'Only deliveries in this status',
      },
      hours: {
        type: 'number',
        minimum: 0.01,
        maximum: MAX_DELIVERY_HOURS,
        default: 24,
        description: `Look back this many hours (at most ${MAX_DELIVERY_HOURS}, 30 days)`,
      },
      limit: { type: 'number', default: 50, minimum: 1, maximum: 1000 },
      cursor: {
        type: 'string',
        description: 'Pagination cursor from previous response',
      },
    },
  },
} as const;

export const WEBHOOK_DELIVERY_RETRY_TOOL = {
  name: 'webhook_delivery_retry',
  description:
    'Send one notice (webhook) again to the customer\'s system, with the exact same event. Use it for a delivery that is "failed" or "delayed" after the customer says their system is working again. It is queued and sent within about a minute; call webhook_deliveries_list later to see the result.',
  inputSchema: {
    type: 'object',
    properties: {
      delivery_id: {
        type: 'string',
        description: 'UUID of the delivery, from webhook_deliveries_list',
      },
    },
    required: ['delivery_id'],
  },
} as const;

export function createWebhookDeliveriesListHandler(
  deliveries: Pick<WebhookDeliveryService, 'listPage'>,
) {
  return async function webhookDeliveriesListHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ deliveries: unknown[]; next_cursor: string | null }> {
    const params = plainToInstance(
      WebhookDeliveriesListInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    // The connection only sees the environment it is working in.
    const query = plainToInstance(WebhookDeliveryQuery, {
      ...params,
      environment: executionEnvironment(ctx),
    });
    const page = await deliveries.listPage(ctx.activeTenantId, query);
    return {
      deliveries: page.data.map(toPublicWebhookDelivery),
      next_cursor: page.pagination.nextCursor,
    };
  };
}

export function createWebhookDeliveryRetryHandler(
  outbox: Pick<WebhookOutboxService, 'manualRetry'>,
) {
  return async function webhookDeliveryRetryHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ): Promise<{ delivery_id: string; retried: true }> {
    const params = plainToInstance(
      WebhookDeliveryRetryInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    await outbox.manualRetry(
      ctx.activeTenantId,
      params.delivery_id,
      executionEnvironment(ctx),
    );
    return { delivery_id: params.delivery_id, retried: true };
  };
}
