import {
  BadRequestException,
  Controller,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PublicRoute } from '@/modules/auth/application/public-route.decorator';
import { RawResponse } from '@/shared/http/response.interceptor';
import { InboundReceiverService } from '../application/inbound-receiver.service';
import { InboundRateLimitGuard } from './inbound-rate-limit.guard';

/** Provider events are small; anything bigger is not a provider. Checked before any signature work. */
export const MAX_INBOUND_BODY_BYTES = 256 * 1024;

@Controller('integrations/inbound')
@PublicRoute()
@UseGuards(InboundRateLimitGuard)
@RawResponse()
export class InboundController {
  constructor(private readonly receiver: InboundReceiverService) {}

  @Post(':publicId')
  @HttpCode(200)
  async receive(
    @Param('publicId') publicId: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    if (!req.rawBody) throw new BadRequestException('Raw body required');
    if (req.rawBody.length > MAX_INBOUND_BODY_BYTES)
      throw new PayloadTooLargeException('Webhook body too large');
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers))
      if (value !== undefined)
        headers[name.toLowerCase()] = Array.isArray(value)
          ? value.join(', ')
          : value;
    const query: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.query ?? {}))
      if (typeof value === 'string') query[name] = value;
    await this.receiver.receive(publicId, {
      rawBody: req.rawBody,
      headers,
      query,
    });
    return { received: true };
  }
}
