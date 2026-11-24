import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUUID,
  Matches,
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
}

export class ServiceFavoriteCreateInput {
  @IsUUID() company_id!: string;
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @Matches(/^\d{6}$/) service_code!: string;
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
    'List the favorite services saved for a company: ready-made label, description, service code, optional default amount and municipality. Use them to fill nfse_issue quickly.',
  inputSchema: {
    type: 'object',
    properties: { company_id: COMPANY_ID },
    required: ['company_id'],
  },
} as const;

export const SERVICE_FAVORITE_CREATE_TOOL = {
  name: 'service_favorite_create',
  description:
    'Save a favorite service for a company (up to 50 per company), so it can be reused on later invoices.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: COMPANY_ID,
      label: { type: 'string', maxLength: 80, description: 'Short name' },
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
    },
    required: ['company_id', 'label', 'description', 'service_code'],
  },
} as const;

export const SERVICE_FAVORITE_DELETE_TOOL = {
  name: 'service_favorite_delete',
  description:
    'Remove a favorite service of a company. It does not touch invoices already issued.',
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
    label: favorite.label,
    description: favorite.description,
    service_code: favorite.serviceCode,
    amount_cents: favorite.amountCents,
    municipality_code: favorite.municipalityCode,
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
    const list = await favorites.list(params.company_id, tenantId);
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
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);
    const tenantId = await scope(companies, params.company_id, ctx);
    const created = await favorites.create(params.company_id, tenantId, {
      label: params.label,
      description: params.description,
      serviceCode: params.service_code,
      amountCents: params.amount_cents ?? null,
      municipalityCode: params.municipality_code ?? null,
    });
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
