import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Controller,
  HttpCode,
  Get,
  Query,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsUrl } from 'class-validator';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { WebhookConfigService } from '../application/webhook-config.service';
import { WebhookDispatcherService } from '../application/webhook-dispatcher.service';
import {
  PUBLIC_WEBHOOK_EVENT_TYPES,
  PublicWebhookEventType,
} from '../domain/webhook-event';
import { WebhookConfig } from '../domain/webhook-config';

class CreateWebhookConfigDto {
  @ApiProperty({
    format: 'uri',
    example: 'https://example.com/webhooks/corvo',
    description: 'HTTPS (or HTTP) address that receives the events.',
  })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;

  @ApiProperty({
    enum: PUBLIC_WEBHOOK_EVENT_TYPES,
    isArray: true,
    minItems: 1,
    description: 'Events this endpoint receives.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(PUBLIC_WEBHOOK_EVENT_TYPES, { each: true })
  events!: PublicWebhookEventType[];
}

type PublicWebhookConfig = Omit<WebhookConfig, 'tenantId' | 'secret'>;

function toPublicWebhookConfig(config: WebhookConfig): PublicWebhookConfig {
  const { tenantId: _, secret: __, ...publicConfig } = config;
  return publicConfig;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksConfigController {
  constructor(
    private readonly configService: WebhookConfigService,
    private readonly dispatcherService: WebhookDispatcherService,
  ) {}

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.view')
  @ApiOperation({ summary: 'List webhooks' })
  @ApiCursorResponse()
  async findAll(
    @Req() req: RequestWithAuthContext,
    @Query() options: CursorQuery,
  ) {
    const configs = await this.configService.listPage(
      req.authContext!.activeTenantId,
      options,
      req.authContext!.apiKeyEnvironment,
    );
    return configs.map(toPublicWebhookConfig);
  }

  @Post()
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Register webhook' })
  async create(
    @Req() req: RequestWithAuthContext,
    @Body() body: CreateWebhookConfigDto,
  ) {
    const config = await this.configService.create(
      req.authContext!.activeTenantId,
      body,
      req.authContext!.apiKeyEnvironment,
    );
    return { ...toPublicWebhookConfig(config), secret: config.secret };
  }

  @Delete(':id')
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Delete webhook' })
  async remove(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.configService.remove(
      req.authContext!.activeTenantId,
      id,
      req.authContext!.apiKeyEnvironment,
    );
    return { deleted: true };
  }

  @Post(':id/test')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Send test event' })
  async test(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.dispatcherService.test(
      req.authContext!.activeTenantId,
      id,
      req.authContext!.apiKeyEnvironment,
    );
  }
}
