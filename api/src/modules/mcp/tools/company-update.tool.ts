import { plainToInstance, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  validate,
} from 'class-validator';
import type { AuthContext } from '@/modules/auth/auth-context';
import { executionEnvironment } from '@/modules/auth/execution-environment.guard';
import type { CompanyService } from '@/modules/company/application/company.service';
import type { UpdateCompanyInput } from '@/modules/company/domain/company';
import { invalidInput } from './tool-input-errors';

export class CompanyUpdateAddressInput {
  @IsOptional() @IsString() @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(10) zip?: string;
}

export class CompanyUpdateInput {
  @IsUUID() company_id!: string;
  @IsOptional() @IsString() @MaxLength(200) trade_name?: string;
  @ValidateIf((_o, value) => value !== undefined)
  @Matches(/^\d{7}$/)
  municipality_code?: string;
  /** null removes the default. */
  @ValidateIf((_o, value) => value !== undefined && value !== null)
  @Matches(/^\d{6}$/)
  default_service_code?: string | null;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CompanyUpdateAddressInput)
  address?: CompanyUpdateAddressInput;
}

export const COMPANY_UPDATE_TOOL = {
  name: 'company_update',
  description:
    'Update the safe registration data of a company: trade name, address, default service code and municipality code. Send only what changes. It does NOT change the CNPJ, legal name, tax regime, rates, certificate or DPS numbering, and it cannot delete the company: those stay in the dashboard or the Companies API. Changing the municipality code changes the place of service of future invoices, so confirm it with the user.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'string', description: 'UUID (see company_list)' },
      trade_name: { type: 'string', maxLength: 200 },
      municipality_code: {
        type: 'string',
        description: 'Seven-digit IBGE municipality code.',
      },
      default_service_code: {
        type: ['string', 'null'],
        description:
          'Six-digit cTribNac service code; null removes the default.',
      },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          number: { type: 'string' },
          complement: { type: 'string' },
          district: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string', description: 'UF, 2 letters' },
          zip: { type: 'string' },
        },
      },
    },
    required: ['company_id'],
  },
} as const;

export function createCompanyUpdateHandler(
  companyService: Pick<CompanyService, 'update'>,
) {
  return async function companyUpdateHandler(
    rawParams: unknown,
    ctx: AuthContext,
  ) {
    const params = plainToInstance(
      CompanyUpdateInput,
      (rawParams ?? {}) as Record<string, unknown>,
    );
    const errors = await validate(params);
    if (errors.length > 0) throw invalidInput(errors);

    const input: UpdateCompanyInput = {};
    if (params.trade_name !== undefined) input.tradeName = params.trade_name;
    if (params.municipality_code !== undefined)
      input.municipalityCode = params.municipality_code;
    if (params.default_service_code !== undefined)
      input.defaultServiceCode = params.default_service_code;
    if (params.address !== undefined) input.address = { ...params.address };
    if (Object.keys(input).length === 0)
      throw new Error(
        'Invalid input: send at least one of trade_name, municipality_code, default_service_code, address',
      );

    const company = await companyService.update(
      params.company_id,
      input,
      ctx.activeTenantId,
      executionEnvironment(ctx),
      ctx.authUserId,
    );
    const snapshot = company.toSnapshot();
    return {
      id: snapshot.id,
      legal_name: snapshot.legalName,
      trade_name: snapshot.tradeName ?? null,
      tax_id: snapshot.taxId,
      municipality_code: snapshot.municipalityCode ?? null,
      default_service_code: snapshot.defaultServiceCode ?? null,
      address: {
        street: snapshot.addressStreet ?? null,
        number: snapshot.addressNumber ?? null,
        complement: snapshot.addressComplement ?? null,
        district: snapshot.addressDistrict ?? null,
        city: snapshot.addressCity ?? null,
        state: snapshot.addressState ?? null,
        zip: snapshot.addressZip ?? null,
      },
    };
  };
}
