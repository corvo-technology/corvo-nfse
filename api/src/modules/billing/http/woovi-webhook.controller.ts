import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { RawResponse } from '@/shared/http/response.interceptor';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import type { WooviConfig } from '@/infra/config/configuration.types';
import {
  WooviPaymentsService,
  type WooviEvent,
} from '../application/woovi-payments.service';

export const WOOVI_CONFIG = Symbol('WOOVI_CONFIG');

function sameToken(sent: string, expected: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Woovi sends the token we registered as `authorization` on every delivery. */
@Controller('webhooks/woovi')
@PublicRoute()
@RawResponse()
export class WooviWebhookController {
  constructor(
    private readonly payments: WooviPaymentsService,
    @Inject(WOOVI_CONFIG) private readonly config: WooviConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: WooviEvent,
  ) {
    const sent = (authorization ?? '').replace(/^Bearer /i, '');
    if (!this.config.webhookToken || !sameToken(sent, this.config.webhookToken))
      throw new UnauthorizedException('Invalid webhook token');
    await this.payments.handleEvent(body ?? {});
    return { received: true };
  }
}
