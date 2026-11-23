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
  MinLength,
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

/** A customer outside Brazil. Replaces `customer.taxId` and `customer.address`. */
export class ForeignCustomerDto {
  @ApiPropertyOptional({
    example: '12-3456789',
    maxLength: 40,
    description:
      "Tax id in the customer's country (DPS NIF). Send this or noTaxIdReason, never both.",
  })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({
    enum: ['exempt', 'not_required'],
    description: 'Why the customer has no tax id (DPS cNaoNIF 1 or 2).',
  })
  @IsOptional()
  @IsString()
  noTaxIdReason?: string;

  @ApiProperty({
    example: 'US',
    description: 'ISO 3166-1 alpha-2 country code, other than BR.',
  })
  @IsString()
  country!: string;

  @ApiProperty({ example: '94105', maxLength: 11 })
  @IsString()
  postalCode!: string;

  @ApiProperty({ example: 'San Francisco', maxLength: 60 })
  @IsString()
  city!: string;

  @ApiProperty({
    example: 'CA',
    maxLength: 60,
    description: 'State, province or region.',
  })
  @IsString()
  region!: string;

  @ApiProperty({ example: '1 Market St', maxLength: 255 })
  @IsString()
  street!: string;

  @ApiProperty({
    example: '100',
    maxLength: 60,
    description: 'Street number. Required by the DPS.',
  })
  @IsString()
  number!: string;

  @ApiProperty({
    example: 'SoMa',
    maxLength: 60,
    description: 'District or neighbourhood. Required by the DPS.',
  })
  @IsString()
  district!: string;

  @ApiPropertyOptional({ example: 'Suite 4', maxLength: 156 })
  @IsOptional()
  @IsString()
  complement?: string;
}

export class CustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerAddressDto)
  address?: CustomerAddressDto;

  @ApiPropertyOptional({
    type: ForeignCustomerDto,
    description:
      'Customer outside Brazil. Cannot be sent with taxId (CPF/CNPJ) or address; name is then required. It does not declare a service export: the invoice keeps its tax treatment.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ForeignCustomerDto)
  foreign?: ForeignCustomerDto;
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

export type InvoiceEmissionType = 'IMMEDIATE' | 'SCHEDULE' | 'RECURRING';
export type InvoiceRecurrenceFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export class RecurrenceOptionsDto {
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  @ApiProperty({ enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] })
  frequency!: InvoiceRecurrenceFrequency;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    example: '2027-06-30',
    description:
      'Last day the recurrence may run (inclusive). Without it the recurrence runs until paused or cancelled.',
  })
  endsOn?: string;
}

export class InvoiceOptionsDto {
  @IsOptional()
  @IsIn(['IMMEDIATE', 'SCHEDULE', 'RECURRING'])
  @ApiPropertyOptional({
    enum: ['IMMEDIATE', 'SCHEDULE', 'RECURRING'],
    description:
      'SCHEDULE and RECURRING do not issue now: they create a schedule (HTTP 202 with the schedule) and competenceDate is the date of the first run, from tomorrow on. Runs happen at 09:00 America/Sao_Paulo on business days (Monday to Friday); a weekend date runs on Monday, and the note takes the competence of the day it runs.',
  })
  type?: InvoiceEmissionType;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceOptionsDto)
  @ApiPropertyOptional({
    type: RecurrenceOptionsDto,
    description: 'Required when type is RECURRING; not allowed otherwise.',
  })
  recurrence?: RecurrenceOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailOptionsDto)
  email?: EmailOptionsDto;
}

export class CreateInvoiceDto {
  /** Company id. Required unless `companyTaxId` is sent; wins if both are sent. */
  @ValidateIf(
    (o: CreateInvoiceDto) => !o.companyTaxId || o.companyId !== undefined,
  )
  @IsUUID()
  companyId?: string;

  /** Company CNPJ (punctuation optional). Required unless `companyId` is sent. */
  @ValidateIf((o: CreateInvoiceDto) => !o.companyId)
  @IsString()
  @IsNotEmpty()
  companyTaxId?: string;

  /** Stored in a varchar(100) column. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalId?: string;

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
      'Deduction from the ISS tax base declared by the issuer, in BRL (> 0 and < amount - discount, max 2 decimals). Sent in the DPS as vDedRed/vDR. The issuer is responsible for the declared value; Corvo does not check whether the deduction is allowed for the service or municipality.',
  })
  @IsOptional()
  @IsNumber()
  deduction?: number;

  @ApiPropertyOptional({
    example: 'PO-4521',
    maxLength: 60,
    description:
      'Purchase order, service order or project number the customer asked to see on the invoice. Sent in the DPS as serv/infoCompl/xPed and printed on the DANFSe. Does not change any tax.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  purchaseOrder?: string;

  @ApiPropertyOptional({
    example: 'Parcela 2 de 3 do contrato 12/2026',
    maxLength: 2000,
    description:
      'Free text printed on the invoice as complementary information (DPS serv/infoCompl/xInfComp). Does not change any tax.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

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

export class SubstituteServiceDto {
  @ApiPropertyOptional({ description: 'New service description.' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Body of POST /invoices/:id/substitute. Only fields the Sefin lets a MEI or Simples Nacional
 * issuer change are accepted (rule E0061): customer, competence date and amount stay as issued.
 */
export class SubstituteInvoiceDto {
  @ApiProperty({
    minLength: CANCELLATION_DESCRIPTION_MIN,
    maxLength: CANCELLATION_DESCRIPTION_MAX,
    description:
      'Why the invoice is being substituted. Sent in the DPS as subst/xMotivo.',
  })
  @IsString()
  @MinLength(CANCELLATION_DESCRIPTION_MIN)
  @MaxLength(CANCELLATION_DESCRIPTION_MAX)
  description!: string;

  @ApiPropertyOptional({ type: SubstituteServiceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubstituteServiceDto)
  service?: SubstituteServiceDto;

  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'New purchase order. Omit to keep the original; send an empty text to remove it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  purchaseOrder?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'New notes. Omit to keep the original; send an empty text to remove it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
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
