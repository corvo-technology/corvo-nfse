import { ApplicationError } from '@/shared/errors/application-error';

export class WebhookNotFoundError extends ApplicationError {
  constructor(id: string) {
    super({
      code: 'WEBHOOK_NOT_FOUND',
      kind: 'not_found',
      safeMessage: 'Webhook not found',
      message: `Webhook ${id} not found`,
      safeDetails: { id },
    });
  }
}

export class WebhookDeliveryNotFoundError extends ApplicationError {
  constructor(id: string) {
    super({
      code: 'WEBHOOK_DELIVERY_NOT_FOUND',
      kind: 'not_found',
      safeMessage: 'Webhook delivery not found',
      message: `Webhook delivery ${id} not found`,
      safeDetails: { id },
    });
  }
}

export class WebhookValidationError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: 'WEBHOOK_VALIDATION_ERROR',
      kind: 'validation',
      safeMessage: message,
      message,
      safeDetails: details as Record<string, string | number | boolean | null>,
    });
  }
}
