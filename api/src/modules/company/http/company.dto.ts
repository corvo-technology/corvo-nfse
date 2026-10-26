import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TaxRegime } from '../domain/company';
import {
  SPECIAL_TAX_REGIME_CODES,
  TAX_REGIME_KINDS,
} from '../domain/fiscal-profile';
import type {
  IssTaxation,
  OperationNature,
  WithholdingPolicy,
} from '../domain/service-tax-profile';

/**
 * Company DTOs — HTTP layer.
 * Structural validation only (required fields, types, lengths).
 * Fiscal validation is handled by CompanyDomainService.validateAndNormalizeCreate/Update().
 */
const TAX_REGIMES: TaxRegime[] = [
  'MEI',
  'Simples Nacional',
  'Lucro Presumido',
  'Lucro Real',
];

const SPECIAL_TAX_REGIME_DESCRIPTION =
  'Special tax regime (regEspTrib, RTC v1.01): 0 Nenhum, 1 Ato Cooperado, ' +
  '2 Estimativa, 3 Microempresa Municipal, 4 Notário ou Registrador, ' +
  '5 Profissional Autônomo, 6 Sociedade de Profissionais.';

export class AddressDto {
  @IsOptional() @IsString() @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(20) number?: string;
  @IsOptional() @IsString() @MaxLength(100) complement?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(10) zip?: string;
}

export class CreateCompanyDto {
  @IsString() @MaxLength(200) legalName!: string;
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @IsString() taxId!: string; // validated by CompanyDomainService
  @IsOptional() @IsString() municipalReg?: string | null; // null = do not set, '' = error
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Send the municipal registration in the DPS. Default false: the Receita rejects it (E0120) when the city has no complementary data for the company.',
  })
  sendMunicipalReg?: boolean;
  @ApiProperty({
    example: '3550308',
    description: 'Required IBGE municipality code (7 digits) in test and live.',
  })
  @IsString()
  @MaxLength(7)
  municipalityCode!: string;
  @ValidateIf((_object, value) => value !== undefined)
  @ApiPropertyOptional({
    type: String,
    example: '010101',
    description:
      'Default national service classification (cTribNac, 6 digits).',
  })
  @IsString()
  @MaxLength(6)
  defaultServiceCode?: string;
  @IsString() @IsIn(TAX_REGIMES) taxRegime!: TaxRegime;
  @IsOptional() @IsBoolean() simpleNational?: boolean;
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsIn(SPECIAL_TAX_REGIME_CODES)
  @ApiPropertyOptional({
    type: String,
    enum: SPECIAL_TAX_REGIME_CODES,
    description: `${SPECIAL_TAX_REGIME_DESCRIPTION} Empty string clears it.`,
  })
  specialRegime?: string;
  @ApiPropertyOptional({
    type: String,
    example: '6.54',
    description:
      'Simples Nacional only: effective total rate (%) of your DAS, sent in the invoice as pTotTribSN. Required for Simples Nacional; ignored for MEI.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  simplesRate?: string;
  @ApiPropertyOptional({
    type: String,
    example: '2.01',
    description:
      'Simples Nacional only: effective ISS rate (%) of your bracket. Only needed when a customer withholds ISS. Ignored for MEI.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  simplesIssRate?: string;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @ApiPropertyOptional({
    description:
      'The CNPJ cannot be changed. Sending the current CNPJ is accepted and ignored; any other value returns 422.',
  })
  @IsOptional()
  @IsString()
  taxId?: string; // validated by CompanyDomainService
  @IsOptional() @IsString() municipalReg?: string | null; // null = clear, '' = error
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Send the municipal registration in the DPS.',
  })
  sendMunicipalReg?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(7)
  municipalityCode?: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '010101',
    description:
      'Default cTribNac. Null removes the default; omission preserves it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  defaultServiceCode?: string | null;
  @IsOptional() @IsString() @IsIn(TAX_REGIMES) taxRegime?: TaxRegime;
  @IsOptional() @IsBoolean() simpleNational?: boolean;
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsIn(SPECIAL_TAX_REGIME_CODES)
  @ApiPropertyOptional({
    type: String,
    enum: SPECIAL_TAX_REGIME_CODES,
    description: `${SPECIAL_TAX_REGIME_DESCRIPTION} Empty string clears it.`,
  })
  specialRegime?: string;
  @ApiPropertyOptional({
    type: String,
    example: '6.54',
    description:
      'Simples Nacional only: effective total rate (%) of your DAS, sent in the invoice as pTotTribSN. Required for Simples Nacional; ignored for MEI.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  simplesRate?: string;
  @ApiPropertyOptional({
    type: String,
    example: '2.01',
    description:
      'Simples Nacional only: effective ISS rate (%) of your bracket. Only needed when a customer withholds ISS. Ignored for MEI.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  simplesIssRate?: string | null;
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto | null; // null = clear address
}

export class ListCompaniesQuery extends CursorQuery {}

export class UpsertFiscalProfileDto {
  @ApiProperty({
    enum: TAX_REGIME_KINDS,
    description: 'Tax regime for the new validity period.',
  })
  @IsIn(TAX_REGIME_KINDS)
  taxRegime!: (typeof TAX_REGIME_KINDS)[number];

  @IsOptional() @IsBoolean() simpleNational?: boolean;
  @IsOptional()
  @IsIn(SPECIAL_TAX_REGIME_CODES)
  @ApiPropertyOptional({
    type: String,
    enum: SPECIAL_TAX_REGIME_CODES,
    nullable: true,
    description: `${SPECIAL_TAX_REGIME_DESCRIPTION} Null means none.`,
  })
  specialTaxRegime?: string | null;
  @IsOptional() @IsBoolean() ibsCbsRegularOption?: boolean;
  @IsOptional() @IsDateString() ibsCbsRegularFrom?: string | null;

  @ApiPropertyOptional({
    enum: ['SN'],
    example: 'SN',
    description:
      'How a ME/EPP apportions federal and municipal taxes (DPS regApTribSN). Only SN (1) is supported; omit it for MEI. ISS_MUNICIPAL and REGULAR (above a sublimit) are refused.',
  })
  @IsOptional()
  @IsIn(['SN', 'ISS_MUNICIPAL', 'REGULAR'])
  simplesApuracao?: 'SN' | 'ISS_MUNICIPAL' | 'REGULAR' | null;

  @ApiPropertyOptional({
    type: String,
    example: '2027-01-01',
    description:
      'Start of the validity period (inclusive). Defaults to today. May be earlier than the whole history, to cover competences before the company was registered.',
  })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({
    description:
      'When true the new validity period is recorded as approved by the acting user.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

const OPERATION_NATURES: OperationNature[] = [
  'SERVICE',
  'GOODS',
  'MIXED',
  'PARTNER_SALON',
];
const ISS_TAXATIONS: IssTaxation[] = ['NORMAL', 'FIXED', 'EXEMPT'];
const WITHHOLDING_POLICIES: WithholdingPolicy[] = [
  'UNKNOWN',
  'NONE_CONFIRMED',
  'CONFIGURED',
];

/** Known withholding rate keys; unknown keys are rejected as unknown_field. */
class WithholdingRatesDto {
  @IsOptional() @IsString() @MaxLength(10) irrf?: string;
  @IsOptional() @IsString() @MaxLength(10) pis?: string;
  @IsOptional() @IsString() @MaxLength(10) cofins?: string;
  @IsOptional() @IsString() @MaxLength(10) csll?: string;
  @IsOptional() @IsString() @MaxLength(10) inss?: string;
}

export class CreateServiceTaxProfileDto {
  @IsString() @MaxLength(120) name!: string;

  @ApiProperty({
    type: String,
    example: '010101',
    description: 'National service classification (cTribNac, 6 digits).',
  })
  @Matches(/^\d{6}$/)
  serviceCode!: string;

  @IsOptional() @IsString() @MaxLength(20) municipalServiceCode?: string | null;
  @IsOptional() @IsString() @MaxLength(9) nbsCode?: string | null;
  @IsOptional() @IsString() @MaxLength(3) cst?: string | null;
  @IsOptional() @IsString() @MaxLength(6) classCode?: string | null;
  @IsOptional() @IsString() @MaxLength(6) operationIndicator?: string | null;
  @IsOptional() @IsIn(OPERATION_NATURES) operationNature?: OperationNature;
  @IsOptional()
  @IsArray()
  @IsIn(TAX_REGIME_KINDS, { each: true })
  regimeApplicability?: (typeof TAX_REGIME_KINDS)[number][];
  @IsOptional()
  @IsString()
  @MaxLength(7)
  incidenceMunicipalityCode?: string | null;
  @IsOptional() @IsIn(ISS_TAXATIONS) issTaxation?: IssTaxation | null;
  @IsOptional() @IsString() @MaxLength(10) issRate?: string | null;
  @IsOptional() @IsBoolean() issWithholdingDefault?: boolean;
  @IsOptional()
  @IsIn(WITHHOLDING_POLICIES)
  withholdingPolicy?: WithholdingPolicy;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WithholdingRatesDto)
  withholdingRates?: Record<string, string>;

  @ApiProperty({ type: String, example: '2027-01-01' })
  @IsDateString()
  effectiveFrom!: string;

  @IsOptional() @IsDateString() effectiveUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(30) classificationSource?: string;
  @IsOptional() @IsString() @MaxLength(40) catalogVersion?: string | null;
}

export class UpdateServiceTaxProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Matches(/^\d{6}$/) serviceCode?: string;
  @IsOptional() @IsString() @MaxLength(20) municipalServiceCode?: string | null;
  @IsOptional() @IsString() @MaxLength(9) nbsCode?: string | null;
  @IsOptional() @IsString() @MaxLength(3) cst?: string | null;
  @IsOptional() @IsString() @MaxLength(6) classCode?: string | null;
  @IsOptional() @IsString() @MaxLength(6) operationIndicator?: string | null;
  @IsOptional() @IsIn(OPERATION_NATURES) operationNature?: OperationNature;
  @IsOptional()
  @IsArray()
  @IsIn(TAX_REGIME_KINDS, { each: true })
  regimeApplicability?: (typeof TAX_REGIME_KINDS)[number][];
  @IsOptional()
  @IsString()
  @MaxLength(7)
  incidenceMunicipalityCode?: string | null;
  @IsOptional() @IsIn(ISS_TAXATIONS) issTaxation?: IssTaxation | null;
  @IsOptional() @IsString() @MaxLength(10) issRate?: string | null;
  @IsOptional() @IsBoolean() issWithholdingDefault?: boolean;
  @IsOptional()
  @IsIn(WITHHOLDING_POLICIES)
  withholdingPolicy?: WithholdingPolicy;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WithholdingRatesDto)
  withholdingRates?: Record<string, string>;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(30) classificationSource?: string;
  @IsOptional() @IsString() @MaxLength(40) catalogVersion?: string | null;
}

export class ListServiceTaxProfilesQuery {
  @ApiPropertyOptional({
    type: String,
    example: '2027-01-01',
    description: 'List profiles effective on this date. Defaults to today.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
