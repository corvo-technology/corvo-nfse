import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { CursorQuery } from '@/shared/http/pagination';
import {
  IsBoolean,
  IsEmail,
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
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { INVOICE_STATUSES, type InvoiceStatus } from '../domain/invoice-status';
import {
  INVOICE_LIST_TYPES,
  type InvoiceListType,
} from '@/modules/fiscal-core/domain/invoice-type';
import { NFE_STATUSES } from '@/modules/nfe/domain/nfe-status';
import { INVOICE_ORIGINS, type InvoiceOrigin } from '../domain/invoice-origin';
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
  @ApiPropertyOptional({
    example: 'Maria Souza',
    description:
      'Customer name. May be omitted when the customer was already saved: the name is filled from the CPF/CNPJ.',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: '12345678909',
    description: 'CPF (11 digits) or CNPJ (14 digits), punctuation optional.',
  })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({
    format: 'email',
    description: 'Where the invoice is e-mailed when `email` is true.',
  })
  @IsOptional()
  @IsString()
  email?: string;
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
  /** `POST /invoices` with `type: "nfe"` is an NF-e: its own DTO validates it (see the controller). */
  static readonly bypassValidation = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'nfe';

  /** Documented on `NfseInvoiceRequest`; the NFS-e is the default, so it can be left out. */
  @ApiHideProperty()
  @IsOptional()
  @IsIn(['nfse'])
  type?: 'nfse';

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Company id. Required unless `companyTaxId` is sent; wins if both are sent.',
  })
  @ValidateIf(
    (o: CreateInvoiceDto) => !o.companyTaxId || o.companyId !== undefined,
  )
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    example: '12345678000195',
    description:
      'Company CNPJ (punctuation optional). Required unless `companyId` is sent.',
  })
  @ValidateIf((o: CreateInvoiceDto) => !o.companyId)
  @IsString()
  @IsNotEmpty()
  companyTaxId?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    example: 'order-1042',
    description:
      'Your own reference. Returned on the invoice and usable as a filter in GET /invoices.',
  })
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

  @ApiProperty({
    example: 1500,
    description: 'Gross amount in BRL, at most 2 decimals.',
  })
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({
    example: 100.5,
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

  @ApiProperty({
    example: '2026-11-24',
    description:
      'Competence date (ISO 8601). Without `options.type` it cannot be in the future (422 `ERROR_FUTURE_DATE`). With `options.type` SCHEDULE or RECURRING it is the date of the first run, from tomorrow on.',
  })
  @IsDateString()
  competenceDate!: string;

  @ApiPropertyOptional({
    description:
      'Whether to e-mail the invoice to the customer once it is authorized (needs `customer.email`).',
  })
  @IsOptional()
  @IsBoolean()
  email?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceOptionsDto)
  options?: InvoiceOptionsDto;
}

export class GetDownloadUrlDto {
  @IsIn(['pdf', 'xml'])
  format!: 'pdf' | 'xml';
}

/**
 * `status` of `GET /invoices`: the NFS-e states by default (the answer to a wrong one is what it
 * always was), the NF-e states with `type=nfe`, the states of both with `type=all`. Reported as
 * `isIn` so the 400 reads the same.
 */
@ValidatorConstraint({ name: 'isIn' })
class IsStatusOfType implements ValidatorConstraintInterface {
  private allowed(args: ValidationArguments): readonly string[] {
    const type = (args.object as { type?: InvoiceListType }).type;
    if (type === 'nfe') return NFE_STATUSES;
    if (type === 'all') return [...INVOICE_STATUSES, ...NFE_STATUSES];
    return INVOICE_STATUSES;
  }
  validate(value: unknown, args: ValidationArguments): boolean {
    return this.allowed(args).includes(value as string);
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be one of the following values: ${this.allowed(args).join(', ')}`;
  }
}

export class ListInvoicesQuery extends CursorQuery {
  @ApiPropertyOptional({
    enum: INVOICE_LIST_TYPES,
    default: 'nfse',
    description:
      '`nfse` (default) lists NFS-e. `nfe` lists NF-e (filters: `companyId`, `status`). `all` lists both in one summary shape (`companyId` and `status` only).',
  })
  @IsOptional()
  @IsIn(INVOICE_LIST_TYPES)
  type?: InvoiceListType;

  @IsOptional() @IsUUID() companyId?: string;

  @IsOptional()
  @Validate(IsStatusOfType)
  status?: InvoiceStatus;

  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() externalId?: string;

  @ApiPropertyOptional({
    description: 'Only invoices issued to this customer CPF/CNPJ (digits).',
  })
  @IsOptional()
  @Matches(/^\d{11}$|^\d{14}$/)
  customerTaxId?: string;

  @ApiPropertyOptional({
    enum: INVOICE_ORIGINS,
    description:
      'Only invoices that came from here: `dashboard` (issued in the web app), `integration` (a sale from a connected payment platform), `schedule` (a scheduled or recurring invoice), `import` (a spreadsheet import) or `api` (sent by a client through the API, including AI agents).',
  })
  @IsOptional()
  @IsIn(INVOICE_ORIGINS)
  origin?: InvoiceOrigin;
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

export class RequestInvoiceEmailDto {
  @ApiPropertyOptional({
    description:
      'Send to this address instead of the customer e-mail on the invoice.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;
}
