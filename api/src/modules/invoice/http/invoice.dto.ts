import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { INVOICE_STATUSES, type InvoiceStatus } from '../domain/invoice-status';
import {
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_DESCRIPTION_MIN,
  CANCELLATION_REASON_CODES,
  type CancellationReasonCode,
} from '../domain/cancellation-reason';

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
  @ApiPropertyOptional({
    example: '3550308',
    description: 'Incidence municipality (7 digits, IBGE code), when known.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{7}$/)
  municipalityCode?: string;
}

export class CustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerAddressDto)
  address?: CustomerAddressDto;
}

/**
 * Fiscal classification input (RTC). All fields optional and validated
 * against the NT2026.002 / RTC v1.01 XSD patterns.
 */
export class ServiceFiscalDto {
  @ApiPropertyOptional({
    example: '010101001',
    description: 'NBS code (9 digits, [0-9]{9}).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/)
  nbsCode?: string;

  @ApiPropertyOptional({
    example: '001',
    description: 'Municipal tax code — cTribMun (3 digits, [0-9]{3}).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}$/)
  cst?: string;

  @ApiPropertyOptional({
    example: '010601',
    description: 'Tax classification code — cClassTrib (6 digits, [0-9]{6}).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  classCode?: string;

  @ApiPropertyOptional({
    example: '000001',
    description: 'Operation indicator — cIndOp (6 digits, [0-9]{6}).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  operationIndicator?: string;
}

export class ServiceDto {
  @ValidateIf((_object, value) => value !== undefined)
  @ApiPropertyOptional({
    example: '010101',
    description:
      'National service code (6 digits). Inherits company.defaultServiceCode when omitted, then 100901 (LC 116 item 10.09).',
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
  @ApiPropertyOptional({
    type: ServiceFiscalDto,
    description:
      'RTC fiscal classification for the service. Optional; passed through to the fiscal engine.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceFiscalDto)
  fiscal?: ServiceFiscalDto;
  @ApiPropertyOptional({
    description:
      'Service profile id (UUID). Optional fiscal classification profile.',
  })
  @IsOptional()
  @IsUUID()
  serviceProfileId?: string;
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

  @ApiPropertyOptional({
    type: CustomerDto,
    description:
      'Customer (tomador). Optional — omit or send an empty object for anonymous consumer invoices; the tomador is then omitted from the DPS.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer?: CustomerDto;
  @IsDefined() @ValidateNested() @Type(() => ServiceDto) service!: ServiceDto;

  @IsNumber() amount!: number;

  @ApiPropertyOptional({
    example: '100.50',
    description:
      'Unconditional discount (>= 0 and <= amount, max 2 decimals). Validated, never silently truncated.',
  })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiPropertyOptional({
    example: 40,
    description:
      'Deduction from the ISS tax base declared by the issuer, in BRL (> 0 and < amount - discount, max 2 decimals). Sent in the DPS as vDedRed/vDR. Use it for the partner professional share of a salon partnership (Lei 13.352/2016). The issuer is responsible for the declared value; Corvo does not validate the partnership contract.',
  })
  @IsOptional()
  @IsNumber()
  deduction?: number;

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

export class CancelInvoiceDto {
  @IsIn(CANCELLATION_REASON_CODES)
  @ApiProperty({ enum: CANCELLATION_REASON_CODES })
  reason!: CancellationReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(CANCELLATION_DESCRIPTION_MAX)
  @ApiPropertyOptional({
    description: `Required (${CANCELLATION_DESCRIPTION_MIN}–${CANCELLATION_DESCRIPTION_MAX} characters) to cancel an authorized NFS-e or an invoice being issued (processing); optional for a queued invoice.`,
  })
  description?: string;
}
