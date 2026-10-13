import { RawResponse } from '@/shared/http/response.interceptor';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { BillingService } from '../application/billing.service';
import { StripeWebhookRateLimitGuard } from './stripe-webhook-rate-limit.guard';

/** Stripe events are far smaller; anything bigger is not Stripe. Checked before the HMAC. */
export const MAX_STRIPE_WEBHOOK_BODY_BYTES = 256 * 1024;

@Controller('webhooks/stripe')
@PublicRoute()
@UseGuards(StripeWebhookRateLimitGuard)
@RawResponse()
export class StripeWebhookController {
  constructor(private readonly billing: BillingService) {}
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody || !signature)
      throw new BadRequestException('Stripe signature and raw body required');
    if (req.rawBody.length > MAX_STRIPE_WEBHOOK_BODY_BYTES)
      throw new PayloadTooLargeException('Stripe webhook body too large');
    await this.billing.webhook(req.rawBody, signature);
    return { received: true };
  }
}
