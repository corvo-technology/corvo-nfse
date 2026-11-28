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
import { ProductFavoritesService } from '../application/product-favorites.service';
import type {
  NewProductFavorite,
  ProductFavorite,
} from '../domain/product-favorite';
import { SaveProductFavoriteDto } from './product-favorites.dto';

export function toNewProduct(dto: SaveProductFavoriteDto): NewProductFavorite {
  return {
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
@ApiTags('product-favorites')
@Controller('companies/:companyId/product-favorites')
export class ProductFavoritesController {
  constructor(
    private readonly products: ProductFavoritesService,
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
  @RequirePermission('nfe.documents.view')
  @ApiOperation({ summary: 'List the saved products of a company' })
  async list(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<ProductFavorite[]>> {
    const tenantId = await this.scope(companyId, req);
    return data(await this.products.list(companyId, tenantId));
  }

  @Post()
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({
    summary: 'Save a product (the same description updates the saved one)',
  })
  async save(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: SaveProductFavoriteDto,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<ProductFavorite>> {
    const tenantId = await this.scope(companyId, req);
    return data(
      await this.products.save(companyId, tenantId, toNewProduct(dto)),
    );
  }

  @Delete(':productId')
  @ApiKeyEndpoint()
  @RequirePermission('nfe.documents.issue')
  @ApiOperation({ summary: 'Remove a saved product' })
  async remove(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Req() req: RequestWithAuthContext,
  ): Promise<DataEnvelope<{ deleted: true }>> {
    const tenantId = await this.scope(companyId, req);
    await this.products.delete(productId, companyId, tenantId);
    return data({ deleted: true });
  }
}
