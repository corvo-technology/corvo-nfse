import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  ValidateIf,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TaxRegime } from '../domain/company';

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
  @IsOptional() @IsString() @MaxLength(50) specialRegime?: string;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @IsOptional() @IsString() taxId?: string; // validated by CompanyDomainService
  @IsOptional() @IsString() municipalReg?: string | null; // null = clear, '' = error
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
  @IsOptional() @IsString() @MaxLength(50) specialRegime?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto | null; // null = clear address
}

export class ListCompaniesQuery extends CursorQuery {}
