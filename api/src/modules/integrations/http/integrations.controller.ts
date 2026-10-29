import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ConnectionService } from '../application/connection.service';
import type { EventOutcome } from '../application/event-handler';
import { OperationService } from '../application/operation.service';
import { ConnectorRegistry } from '../domain/connector-registry';
import type { ConnectorManifest } from '../domain/connector';
import type { IntegrationConnection } from '../domain/integration-connection';
import {
  IIntegrationEventRepository,
  type IntegrationEventSummary,
} from '../domain/integration-event.repository';
import type { IntegrationOperation } from '../domain/integration-operation';
import type { IntegrationRule } from '../domain/integration-rule';
import {
  CompleteCustomerDto,
  CreateConnectionDto,
  PutRulesDto,
} from './integrations.dto';

const tenantOf = (req: RequestWithAuthContext) =>
  req.authContext!.activeTenantId;

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly connections: ConnectionService,
    private readonly operationService: OperationService,
    private readonly eventRepo: IIntegrationEventRepository,
    private readonly config: ConfigService,
  ) {}

  @Get('providers')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({ summary: 'List the payment platforms Corvo can connect to' })
  providers(): ConnectorManifest[] {
    return this.registry.manifests();
  }

  @Post('connections')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Create a connection' })
  async create(
    @Req() req: RequestWithAuthContext,
    @Body() body: CreateConnectionDto,
  ) {
    const connection = await this.connections.create(tenantOf(req), {
      ...body,
      activeFrom: body.activeFrom ? new Date(body.activeFrom) : undefined,
    });
    return this.present(connection);
  }

  @Get('connections')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({ summary: 'List connections' })
  async list(@Req() req: RequestWithAuthContext) {
    return (await this.connections.list(tenantOf(req))).map((c) =>
      this.present(c),
    );
  }

  @Get('connections/:id')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({ summary: 'Get a connection' })
  async get(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.present(await this.connections.get(tenantOf(req), id));
  }

  @Post('connections/:id/validate')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({
    summary: 'Check the credentials and identify the external account',
  })
  async validate(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.present(await this.connections.validate(tenantOf(req), id));
  }

  @Post('connections/:id/activate')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Start issuing invoices automatically' })
  async activate(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.present(await this.connections.activate(tenantOf(req), id));
  }

  @Post('connections/:id/pause')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Stop issuing; events are still recorded' })
  async pause(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.present(await this.connections.pause(tenantOf(req), id));
  }

  @Post('connections/:id/disconnect')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Disconnect for good' })
  async disconnect(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.present(await this.connections.disconnect(tenantOf(req), id));
  }

  @Get('connections/:id/rules')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({ summary: 'List the rules of a connection' })
  async rules(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return (await this.connections.listRules(tenantOf(req), id)).map(
      presentRule,
    );
  }

  @Put('connections/:id/rules')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Replace the rules of a connection' })
  async putRules(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PutRulesDto,
  ) {
    const saved = await this.connections.replaceRules(
      tenantOf(req),
      id,
      body.rules.map((rule) => ({
        externalProductId: rule.externalProductId ?? null,
        service: rule.service as unknown as Record<string, unknown>,
        sendEmail: rule.sendEmail,
        allowAnonymousCustomer: rule.allowAnonymousCustomer ?? false,
      })),
    );
    return saved.map(presentRule);
  }

  @Get('connections/:id/events')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({ summary: 'Recent events received for a connection' })
  async events(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<IntegrationEventSummary[]> {
    await this.connections.get(tenantOf(req), id);
    return this.eventRepo.listByConnection(
      id,
      tenantOf(req),
      clampLimit(limit),
    );
  }

  @Get('connections/:id/operations')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.view')
  @ApiOperation({
    summary: 'Recent operations (sales) and their invoice status',
  })
  async operations(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    await this.connections.get(tenantOf(req), id);
    const rows = await this.operationService.list(
      tenantOf(req),
      id,
      clampLimit(limit),
    );
    return rows.map(presentOperation);
  }

  @Patch('operations/:id/customer')
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({
    summary: 'Fill in the customer of an operation waiting for it',
  })
  async completeCustomer(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CompleteCustomerDto,
  ) {
    return presentOperation(
      await this.operationService.completeCustomer(tenantOf(req), id, body),
    );
  }

  @Post('operations/:id/retry')
  @HttpCode(200)
  @ApiKeyEndpoint()
  @RequirePermission('integrations.manage')
  @ApiOperation({ summary: 'Try to issue the invoice of an operation again' })
  retry(
    @Req() req: RequestWithAuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EventOutcome> {
    return this.operationService.retry(tenantOf(req), id);
  }

  private present(connection: IntegrationConnection) {
    const app = this.config.get<{ publicApiUrl?: string; apiPrefix?: string }>(
      'app',
    );
    const prefix = app?.apiPrefix ?? 'v1';
    return {
      id: connection.id,
      provider: connection.provider,
      environment: connection.environment,
      companyId: connection.companyId,
      state: connection.state,
      externalAccountId: connection.externalAccountId,
      activeFrom: connection.activeFrom,
      webhookUrl: `${app?.publicApiUrl ?? ''}/${prefix}/integrations/inbound/${connection.publicId}`,
      createdAt: connection.createdAt,
    };
  }
}

const clampLimit = (limit?: number) => Math.min(Math.max(limit ?? 50, 1), 100);

const presentRule = (rule: IntegrationRule) => ({
  id: rule.id,
  externalProductId: rule.externalProductId,
  service: rule.service,
  sendEmail: rule.sendEmail,
  allowAnonymousCustomer: rule.allowAnonymousCustomer,
});

const presentOperation = (op: IntegrationOperation) => ({
  id: op.id,
  operationKey: op.operationKey,
  commercialState: op.commercialState,
  fiscalStatus: op.fiscalStatus,
  blockReason: op.blockReason,
  amountCents: op.snapshot.amountCents,
  currency: op.snapshot.currency,
  customer: op.snapshot.customer,
  paidAt: op.snapshot.paidAt,
  invoiceId: op.invoiceId,
  createdAt: op.createdAt,
  updatedAt: op.updatedAt,
});
