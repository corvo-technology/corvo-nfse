import { ApiPropertyOptional } from '@nestjs/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  IsBoolean,
  IsDefined,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsUUID,
  IsNotEmpty,
  ValidateIf,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { INVOICE_STATUSES, type InvoiceStatus } from '../domain/invoice-status';

/**
 * Invoice DTOs — HTTP layer.
 * Structural validation only (required fields, types, lengths).
 * Fiscal validation is handled by InvoiceDomainService.normalizeAndValidate().
 */
export class CustomerAddressDto {
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zip?: string;
  @IsOptional() @IsString() country?: string;
}

export class CustomerDto {
  @IsString() name!: string;
  @IsString() taxId!: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerAddressDto)
  address?: CustomerAddressDto;
}

export class ServiceDto {
  @ValidateIf((_object, value) => value !== undefined)
  @ApiPropertyOptional({
    example: '010101',
    description:
      'National service code (6 digits). Inherits company.defaultServiceCode when omitted.',
  })
  @IsString()
  code?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @ApiPropertyOptional({
    example: '3550308',
    description:
      'Place of service (7 digits). Inherits company.municipalityCode when omitted.',
  })
  @IsString()
  municipalityCode?: string;
  @IsOptional() @IsString() description?: string;
}

export class EmailOptionsDto {
  @IsOptional() @IsBoolean() send?: boolean;
}

export type InvoiceEmissionType = 'IMMEDIATE' | 'SCHEDULE';

export class InvoiceOptionsDto {
  @IsOptional()
  @IsIn(['IMMEDIATE', 'SCHEDULE'])
  @ApiPropertyOptional({
    enum: ['IMMEDIATE', 'SCHEDULE'],
    description:
      'SCHEDULE accepts a future competenceDate; the invoice is released at 00:00 America/Sao_Paulo of that day.',
  })
  type?: InvoiceEmissionType;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailOptionsDto)
  email?: EmailOptionsDto;
}

export class CreateInvoiceDto {
  /** Company id. Required unless `companyTaxId` is sent; wins if both are sent. */
  @ValidateIf((o: CreateInvoiceDto) => !o.companyTaxId)
  @IsUUID()
  companyId?: string;

  /** Company CNPJ (punctuation optional). Required unless `companyId` is sent. */
  @ValidateIf((o: CreateInvoiceDto) => !o.companyId)
  @IsString()
  @IsNotEmpty()
  companyTaxId?: string;

  @IsOptional() @IsString() externalId?: string;

  @ValidateNested() @Type(() => CustomerDto) customer!: CustomerDto;
  @IsDefined() @ValidateNested() @Type(() => ServiceDto) service!: ServiceDto;

  @IsNumber() amount!: number;
  @IsDateString() competenceDate!: string;

  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceOptionsDto)
  options?: InvoiceOptionsDto;
}

export class GetDownloadUrlDto {
  @IsIn(['pdf', 'xml'])
  format!: 'pdf' | 'xml';
}

export class ListInvoicesQuery extends CursorQuery {
  @IsOptional() @IsUUID() companyId?: string;

  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() externalId?: string;
}
