import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { WebhookDeliveryQuery } from '@/shared/http/webhook-delivery-query';
import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  HttpCode,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { WebhookDeliveryService } from '../application/webhook-delivery.service';
import { WebhookOutboxService } from '../application/webhook-outbox.service';

@ApiTags('webhooks')
@Controller('webhooks/deliveries')
export class WebhookDeliveryController {
  constructor(
    private readonly deliveryService: WebhookDeliveryService,
    private readonly outboxService: WebhookOutboxService,
  ) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.view')
  @ApiOperation({ summary: 'List recent webhook deliveries (last 24h)' })
  @ApiCursorResponse()
  async findAll(
    @Req() req: RequestWithAuthContext,
    @Query() options: WebhookDeliveryQuery,
  ) {
    // An API key only sees deliveries of its own environment, whatever the query says.
    const keyEnvironment = req.authContext!.apiKeyEnvironment;
    return this.deliveryService.listPage(req.authContext!.activeTenantId, {
      ...options,
      environment: keyEnvironment ?? options.environment,
    });
  }

  @Get('stats')
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.view')
  @ApiOperation({ summary: 'Get webhook delivery stats' })
  async getStats(
    @Req() req: RequestWithAuthContext,
    @Query() options: WebhookDeliveryQuery,
  ) {
    return this.deliveryService.getStats(
      req.authContext!.activeTenantId,
      options.hours,
      req.authContext!.apiKeyEnvironment ?? options.environment,
    );
  }

  @Post(':id/retry')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Manual retry webhook delivery' })
  async retryDelivery(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.outboxService.manualRetry(
      req.authContext!.activeTenantId,
      id,
      req.authContext!.apiKeyEnvironment,
    );
    return { retried: true };
  }
}
