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

/** The notice body is erased 30 days after a successful send (data retention), so it cannot be sent again. */
export class WebhookDeliveryContentErasedError extends ApplicationError {
  constructor(id: string) {
    super({
      code: 'WEBHOOK_DELIVERY_CONTENT_ERASED',
      kind: 'conflict',
      safeMessage:
        'The content of this delivery was erased after 30 days, so it cannot be sent again',
      message: `Webhook delivery ${id} has no payload (erased by data retention); it cannot be retried`,
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
