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
import type { ServiceFavoritesService } from '@/modules/service-favorites/application/service-favorites.service';
import type { ServiceFavorite } from '@/modules/service-favorites/domain/service-favorite';
import { invalidInput } from './tool-input-errors';

type Companies = Pick<CompanyService, 'findById'>;

export class ServiceFavoriteListInput {
  @IsUUID() company_id!: string;
  @IsOptional() @IsIn(['service', 'product']) kind?: 'service' | 'product';
}

const isService = (o: ServiceFavoriteCreateInput) => o.kind !== 'product';
const isProduct = (o: ServiceFavoriteCreateInput) => o.kind === 'product';
const sentOnProduct = (o: ServiceFavoriteCreateInput, v: unknown) =>
  isProduct(o) && v !== undefined && v !== null;

export class ServiceFavoriteCreateInput {
  @IsUUID() company_id!: string;
  @IsOptional() @IsIn(['service', 'product']) kind?: 'service' | 'product';
  @ValidateIf(isService)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @ValidateIf(isService) @Matches(/^\d{6}$/) service_code?: string;
  @ValidateIf(sentOnProduct) @IsString() @MaxLength(60) code?: string;
  @ValidateIf(sentOnProduct)
  @Matches(/^\d{8}$|^\d{12,14}$/)
  gtin?: string | null;
  @ValidateIf(isProduct) @Matches(/^\d{8}$/) ncm?: string;
  @ValidateIf(sentOnProduct) @Matches(/^\d{7}$/) cest?: string | null;
  @ValidateIf(sentOnProduct) @Matches(/^\d{4}$/) cfop?: string | null;
  @ValidateIf(sentOnProduct)
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  unit?: string;
  @ValidateIf(isProduct)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999999)
  unit_price?: number;
  @ValidateIf(sentOnProduct) @IsIn(['102', '400']) csosn?: string | null;
  @ValidateIf(sentOnProduct) @IsInt() @Min(0) @Max(8) origin?: number | null;
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  amount_cents?: number | null;
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @Matches(/^\d{7}$/)
  municipality_code?: string | null;
}

export class ServiceFavoriteDeleteInput {
  @IsUUID() company_id!: string;
  @IsUUID() favorite_id!: string;
}

const COMPANY_ID = {
  type: 'string',
  description: 'UUID of the company (see company_list)',
} as const;

export const SERVICE_FAVORITE_LIST_TOOL = {
  name: 'service_favorite_list',
  description:
    'List the favorites saved for a company. The default kind is "service": label, description, service code, optional default amount and municipality, to fill nfse_issue quickly. With kind "product": description, code, barcode, NCM, CEST, default CFOP, unit and unit price, to fill the items of nfse_issue with type "nfe" or "nfce".',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      kind: {
        type: 'string',
        enum: ['service', 'product'],
        description: 'Default service',
      },
    },
    required: ['company_id'],
  },
} as const;

export const SERVICE_FAVORITE_CREATE_TOOL = {
  name: 'service_favorite_create',
  description:
    'Save a favorite for a company so it can be reused on later invoices. A service (default kind, up to 50 per company) needs label, description and service_code. With kind "product" (up to 500; the same description updates the saved one) send description, ncm and unit_price, and optionally code, gtin, cest, cfop, unit, csosn and origin. Corvo does not calculate taxes: the person informs NCM and, when needed, CFOP and CSOSN.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      kind: {
        type: 'string',
        enum: ['service', 'product'],
        description: 'Default service',
      },
      label: {
        type: 'string',
        maxLength: 80,
        description: 'Short name (service only)',
      },
      description: {
        type: 'string',
        maxLength: 2000,
        description: 'Service description printed on the invoice',
      },
      service_code: {
        type: 'string',
        description: 'National service code (cTribNac), 6 digits',
      },
      amount_cents: {
        type: ['integer', 'null'],
        description: 'Default amount in cents (R$ 150,00 = 15000), optional',
      },
      municipality_code: {
        type: ['string', 'null'],
        description: 'IBGE place of service (7 digits), optional',
      },
      code: {
        type: 'string',
        maxLength: 60,
        description: 'Product: your code',
      },
      gtin: { type: ['string', 'null'], description: 'Product: barcode' },
      ncm: { type: 'string', description: 'Product: NCM, 8 digits' },
      cest: {
        type: ['string', 'null'],
        description: 'Product: CEST, 7 digits',
      },
      cfop: { type: ['string', 'null'], description: 'Product: default CFOP' },
      unit: {
        type: 'string',
        maxLength: 6,
        description: 'Product: unit, default UN',
      },
      unit_price: {
        type: 'number',
        description: 'Product: price of one unit in reais',
      },
      csosn: { type: ['string', 'null'], description: 'Product: 102 or 400' },
      origin: {
        type: ['integer', 'null'],
        description: 'Product: origin, 0 to 8',
      },
    },
    required: ['company_id', 'description'],
  },
} as const;

export const SERVICE_FAVORITE_DELETE_TOOL = {
  name: 'service_favorite_delete',
  description:
    'Remove a favorite (service or product) of a company. It does not touch invoices already issued.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      favorite_id: { type: 'string', description: 'UUID of the favorite' },
    },
    required: ['company_id', 'favorite_id'],
  },
} as const;

function view(favorite: ServiceFavorite) {
  return {
    id: favorite.id,
    company_id: favorite.companyId,
    kind: favorite.kind,
    label: favorite.label,
    description: favorite.description,
    service_code: favorite.serviceCode,
    amount_cents: favorite.amountCents,
    municipality_code: favorite.municipalityCode,
    ...(favorite.kind === 'product'
      ? {
          code: favorite.code,
          gtin: favorite.gtin,
          ncm: favorite.ncm,
          cest: favorite.cest,
          cfop: favorite.cfop,
          unit: favorite.unit,
          unit_price: favorite.unitPrice,
          csosn: favorite.csosn,
          origin: favorite.origin,
        }
      : {}),
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

export function createServiceFavoriteListHandler(
  favorites: Pick<ServiceFavoritesService, 'list'>,
  companies: Companies,
) {
  return async function serviceFavoriteListHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      ServiceFavoriteListInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const tenantId = await scope(companies, params.company_id, ctx);
    const list = await favorites.list(
      params.company_id,
      tenantId,
      params.kind ?? 'service',
    );
    return { favorites: list.map(view) };
  };
}

export function createServiceFavoriteCreateHandler(
  favorites: Pick<ServiceFavoritesService, 'create'>,
  companies: Companies,
) {
  return async function serviceFavoriteCreateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      ServiceFavoriteCreateInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    if (typeof params.label === 'string') params.label = params.label.trim();
    if (typeof params.description === 'string')
      params.description = params.description.trim();
    if (params.kind === 'product' && params.description.length > 120)
      throw new Error('Invalid input: description: up to 120 characters');
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const tenantId = await scope(companies, params.company_id, ctx);
    const created = await favorites.create(
      params.company_id,
      tenantId,
      params.kind === 'product'
        ? {
            kind: 'product',
            label: params.description,
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
          }
        : {
            kind: 'service',
            label: params.label as string,
            description: params.description,
            serviceCode: params.service_code,
            amountCents: params.amount_cents ?? null,
            municipalityCode: params.municipality_code ?? null,
          },
    );
    return view(created);
  };
}

export function createServiceFavoriteDeleteHandler(
  favorites: Pick<ServiceFavoritesService, 'delete'>,
  companies: Companies,
) {
  return async function serviceFavoriteDeleteHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      ServiceFavoriteDeleteInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const tenantId = await scope(companies, params.company_id, ctx);
    await favorites.delete(params.favorite_id, params.company_id, tenantId);
    return { favorite_id: params.favorite_id, deleted: true };
  };
}
