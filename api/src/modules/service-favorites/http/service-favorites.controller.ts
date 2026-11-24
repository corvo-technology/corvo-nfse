import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ExecutionEnvironmentGuard,
  executionEnvironment,
} from '@/modules/auth/execution-environment.guard';
import { RequirePermission } from '@/modules/auth/require-permission.decorator';
import { ApiKeyEndpoint } from '@/modules/auth/api-key-endpoint.decorator';
import type {
  AuthContext,
  RequestWithAuthContext,
} from '@/modules/auth/auth-context';
import { CompanyService } from '@/modules/company/application/company.service';
import { data } from '@/shared/http/response';
import type { DataEnvelope } from '@/shared/http/response';
import { ServiceFavoritesService } from '../application/service-favorites.service';
import type { ServiceFavorite } from '../domain/service-favorite';
import { CreateServiceFavoriteDto } from './service-favorites.dto';

@UseGuards(ExecutionEnvironmentGuard)
@ApiTags('service-favorites')
@Controller('companies/:companyId/service-favorites')
export class ServiceFavoritesController {
  constructor(
    private readonly favorites: ServiceFavoritesService,
    private readonly companies: CompanyService,
  ) {}

  private requireAuthContext(req: RequestWithAuthContext): AuthContext {
    const context = req.authContext;
    if (!context)
      throw new UnauthorizedException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Authentication context is required',
      });
    return context;
  }

  /** The company must belong to the active tenant and environment. */
  private async scope(companyId: string, req: RequestWithAuthContext) {
    const context = this.requireAuthContext(req);
    await this.companies.findById(
      companyId,
      context.activeTenantId,
      executionEnvironment(context),
    );
    return context.activeTenantId;
  }

  @Get()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.view')
  @ApiOperation({ summary: 'List the favorite services of a company' })
  async list(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<ServiceFavorite[]>> {
    const tenantId = await this.scope(companyId, req);
    return data(await this.favorites.list(companyId, tenantId));
  }

  @Post()
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Save a favorite service for the company' })
  async create(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: CreateServiceFavoriteDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<ServiceFavorite>> {
    const tenantId = await this.scope(companyId, req);
    return data(
      await this.favorites.create(companyId, tenantId, {
        label: dto.label,
        description: dto.description,
        serviceCode: dto.serviceCode,
        amountCents: dto.amountCents ?? null,
        municipalityCode: dto.municipalityCode ?? null,
      }),
    );
  }

  @Delete(':favoriteId')
  @ApiKeyEndpoint()
  @RequirePermission('nfse.invoices.issue')
  @ApiOperation({ summary: 'Remove a favorite service' })
  async remove(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('favoriteId', new ParseUUIDPipe()) favoriteId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<{ deleted: true }>> {
    const tenantId = await this.scope(companyId, req);
    await this.favorites.delete(favoriteId, companyId, tenantId);
    return data({ deleted: true });
  }
}
