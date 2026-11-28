import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { ProductFavoritesService } from '@/modules/product-favorites/application/product-favorites.service';
import type { ProductFavorite } from '@/modules/product-favorites/domain/product-favorite';
import { invalidInput } from './tool-input-errors';

type Companies = Pick<CompanyService, 'findById'>;

const nullable = () =>
  ValidateIf((_o, value) => value !== undefined && value !== null);

export class ProductFavoriteListInput {
  @IsUUID() company_id!: string;
}

export class ProductFavoriteCreateInput {
  @IsUUID() company_id!: string;
  @IsString() @MinLength(1) @MaxLength(120) description!: string;
  @IsOptional() @IsString() @MaxLength(60) code?: string;
  @nullable() @Matches(/^\d{8}$|^\d{12,14}$/) gtin?: string | null;
  @Matches(/^\d{8}$/) ncm!: string;
  @nullable() @Matches(/^\d{7}$/) cest?: string | null;
  @nullable() @Matches(/^\d{4}$/) cfop?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(6) unit?: string;
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999999)
  unit_price!: number;
  @nullable() @IsIn(['102', '400']) csosn?: string | null;
  @nullable() @IsInt() @Min(0) @Max(8) origin?: number | null;
}

export class ProductFavoriteDeleteInput {
  @IsUUID() company_id!: string;
  @IsUUID() product_id!: string;
}

const COMPANY_ID = {
  type: 'string',
  description: 'UUID of the company (see company_list)',
} as const;

export const PRODUCT_FAVORITE_LIST_TOOL = {
  name: 'product_favorite_list',
  description:
    'List the products saved for a company (name, code, barcode, NCM, CEST, default CFOP, unit, unit price). Use them to fill the items of nfse_issue with type "nfe" or "nfce".',
  inputSchema: {
    type: 'object',
    properties: { company_id: COMPANY_ID },
    required: ['company_id'],
  },
} as const;

export const PRODUCT_FAVORITE_CREATE_TOOL = {
  name: 'product_favorite_create',
  description:
    'Save a product for a company (up to 500). Saving the same description again updates the saved product. Corvo does not calculate taxes: the person informs NCM and, when needed, CFOP and CSOSN.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      description: {
        type: 'string',
        maxLength: 120,
        description: 'Name printed on the note',
      },
      code: {
        type: 'string',
        maxLength: 60,
        description: 'Your product code, optional',
      },
      gtin: {
        type: ['string', 'null'],
        description: 'Barcode (8, 12, 13 or 14 digits), optional',
      },
      ncm: { type: 'string', description: 'NCM, 8 digits' },
      cest: {
        type: ['string', 'null'],
        description: 'CEST, 7 digits, optional',
      },
      cfop: {
        type: ['string', 'null'],
        description: 'Default CFOP, 4 digits, optional',
      },
      unit: { type: 'string', maxLength: 6, description: 'Unit, default UN' },
      unit_price: { type: 'number', description: 'Price of one unit in reais' },
      csosn: {
        type: ['string', 'null'],
        description: '102 or 400; leave out to follow the company',
      },
      origin: {
        type: ['integer', 'null'],
        description: 'Origin of the goods, 0 to 8, optional',
      },
    },
    required: ['company_id', 'description', 'ncm', 'unit_price'],
  },
} as const;

export const PRODUCT_FAVORITE_DELETE_TOOL = {
  name: 'product_favorite_delete',
  description:
    'Remove a saved product of a company. It does not touch notes already issued.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      product_id: { type: 'string', description: 'UUID of the saved product' },
    },
    required: ['company_id', 'product_id'],
  },
} as const;

function view(product: ProductFavorite) {
  return {
    id: product.id,
    company_id: product.companyId,
    description: product.description,
    code: product.code,
    gtin: product.gtin,
    ncm: product.ncm,
    cest: product.cest,
    cfop: product.cfop,
    unit: product.unit,
    unit_price: product.unitPrice,
    csosn: product.csosn,
    origin: product.origin,
  };
}

/** The company must belong to the caller's workspace and environment. */
async function scope(
  companies: Companies,
  companyId: string,
  ctx: AuthContext,
): Promise<string> {
  await companies.findById(
    companyId,
    ctx.activeTenantId,
    executionEnvironment(ctx),
  );
  return ctx.activeTenantId;
}

async function parse<T extends object>(
  type: new () => T,
  raw: unknown,
): Promise<T> {
  const params = plainToInstance(type, (raw ?? {}) as Record<string, unknown>);
  const errors = await validate(params);
  if (errors.length > 0) throw invalidInput(errors);
  return params;
}

export function createProductFavoriteListHandler(
  products: Pick<ProductFavoritesService, 'list'>,
  companies: Companies,
) {
  return async function productFavoriteListHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = await parse(ProductFavoriteListInput, rawParams);
    const tenantId = await scope(companies, params.company_id, ctx);
    const list = await products.list(params.company_id, tenantId);
    return { products: list.map(view) };
  };
}

export function createProductFavoriteCreateHandler(
  products: Pick<ProductFavoritesService, 'save'>,
  companies: Companies,
) {
  return async function productFavoriteCreateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const raw = { ...((rawParams ?? {}) as Record<string, unknown>) };
    for (const key of ['description', 'code', 'unit'])
      if (typeof raw[key] === 'string') raw[key] = raw[key].trim();
    const params = await parse(ProductFavoriteCreateInput, raw);
    const tenantId = await scope(companies, params.company_id, ctx);
    const saved = await products.save(params.company_id, tenantId, {
      description: params.description,
      code: params.code ?? '',
      gtin: params.gtin ?? null,
      ncm: params.ncm,
      cest: params.cest ?? null,
      cfop: params.cfop ?? null,
      unit: params.unit ?? 'UN',
      unitPrice: params.unit_price,
      csosn: params.csosn ?? null,
      origin: params.origin ?? null,
    });
    return view(saved);
  };
}

export function createProductFavoriteDeleteHandler(
  products: Pick<ProductFavoritesService, 'delete'>,
  companies: Companies,
) {
  return async function productFavoriteDeleteHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = await parse(ProductFavoriteDeleteInput, rawParams);
    const tenantId = await scope(companies, params.company_id, ctx);
    await products.delete(params.product_id, params.company_id, tenantId);
    return { product_id: params.product_id, deleted: true };
  };
}
