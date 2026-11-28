import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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
import type {
  FavoriteKind,
  NewServiceFavorite,
  ServiceFavorite,
} from '../domain/service-favorite';
import {
  CreateServiceFavoriteDto,
  PRODUCT_DESCRIPTION_MAX,
} from './service-favorites.dto';

function kindOf(value: string | undefined): FavoriteKind {
  if (value === undefined || value === 'service') return 'service';
  if (value === 'product') return 'product';
  throw new BadRequestException({
    code: 'ERROR_VALIDATION',
    message: 'kind must be service or product',
  });
}

function toNewFavorite(dto: CreateServiceFavoriteDto): NewServiceFavorite {
  if (dto.kind !== 'product')
    return {
      kind: 'service',
      label: dto.label as string,
      description: dto.description,
      serviceCode: dto.serviceCode,
      amountCents: dto.amountCents ?? null,
      municipalityCode: dto.municipalityCode ?? null,
    };
  if (dto.description.length > PRODUCT_DESCRIPTION_MAX)
    throw new BadRequestException({
      code: 'ERROR_VALIDATION',
      message: `description of a product has up to ${PRODUCT_DESCRIPTION_MAX} characters`,
    });
  return {
    kind: 'product',
    label: dto.description,
    description: dto.description,
    code: dto.code ?? '',
    gtin: dto.gtin ?? null,
    ncm: dto.ncm,
    cest: dto.cest ?? null,
    cfop: dto.cfop ?? null,
    unit: dto.unit ?? 'UN',
    unitPrice: dto.unitPrice,
    csosn: dto.csosn ?? null,
    origin: dto.origin ?? null,
  };
}

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
  @RequirePermission(['nfse.invoices.view', 'nfe.documents.view'])
  @ApiOperation({
    summary:
      'List the favorite services of a company (`?kind=product` lists the products)',
  })
  @ApiQuery({ name: 'kind', required: false, enum: ['service', 'product'] })
  async list(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
    @Query('kind') kind?: string,
  ): Promise<DataEnvelope<ServiceFavorite[]>> {
    const tenantId = await this.scope(companyId, req);
    return data(await this.favorites.list(companyId, tenantId, kindOf(kind)));
  }

  @Post()
  @ApiKeyEndpoint()
  @RequirePermission(['nfse.invoices.issue', 'nfe.documents.issue'])
  @ApiOperation({
    summary:
      'Save a favorite service for the company, or a product with `kind: "product"`',
  })
  async create(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: CreateServiceFavoriteDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<ServiceFavorite>> {
    const tenantId = await this.scope(companyId, req);
    return data(
      await this.favorites.create(companyId, tenantId, toNewFavorite(dto)),
    );
  }

  @Delete(':favoriteId')
  @ApiKeyEndpoint()
  @RequirePermission(['nfse.invoices.issue', 'nfe.documents.issue'])
  @ApiOperation({ summary: 'Remove a favorite (service or product)' })
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
