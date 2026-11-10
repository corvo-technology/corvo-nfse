import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CANCELLATION_DESCRIPTION_MAX,
  CANCELLATION_REASON_CODES,
  type CancellationReasonCode,
} from '@/modules/invoice/domain/cancellation-reason';

/**
 * MCP tool input DTOs — snake_case wire contract for the NFS-e MCP tools.
 *
 * These mirror the snake_case JSON the MCP client sends. The nfse_issue handler
 * maps them onto the real (camelCase) `CreateInvoiceDto`. Shared by Task 6
 * (nfse_issue) and Task 7 (nfse_query / nfse_list / nfse_download_pdf).
 */

export class AddressInput {
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zip?: string;
}

export class CustomerInput {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() tax_id?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressInput)
  address?: AddressInput;
}

export class ServiceInput {
  @IsString() description!: string;
  @IsNumber() @Min(1) quantity!: number;
  @IsNumber() @Min(0.01) unit_price!: number;
}

export class NfseIssueInput {
  /** The issuing company: send its id or its CNPJ. */
  @ValidateIf((o: NfseIssueInput) => !o.company_tax_id)
  @IsUUID()
  company_id?: string;

  @ValidateIf((o: NfseIssueInput) => !o.company_id)
  @IsString()
  @IsNotEmpty()
  company_tax_id?: string;

  /** Optional: omit it for an anonymous consumer invoice. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInput)
  customer?: CustomerInput;

  /** Simple form: total amount of the service, in BRL. */
  @ValidateIf((o: NfseIssueInput) => o.services === undefined)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional() @IsString() description?: string;

  /** Itemized form: the amount is the sum of quantity x unit_price. */
  @ValidateIf((o: NfseIssueInput) => o.amount === undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ServiceInput)
  services?: ServiceInput[];

  @IsOptional() @IsNumber() @Min(0) discount?: number;

  @IsOptional() @IsNumber() @Min(0) deduction?: number;

  /** Customer purchase order printed on the invoice (DPS xPed). */
  @IsOptional() @IsString() @MaxLength(60) purchase_order?: string;

  /** Free text printed on the invoice as complementary information (DPS xInfComp). */
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  /** YYYY-MM-DD. Defaults to today (America/Sao_Paulo). */
  @IsOptional() @IsDateString() competence_date?: string;

  @IsOptional() @IsIn(['IMMEDIATE', 'SCHEDULE', 'RECURRING']) emission_type?:
    'IMMEDIATE' | 'SCHEDULE' | 'RECURRING';

  /** Required with emission_type RECURRING. */
  @IsOptional() @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY']) recurrence_frequency?:
    'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

  /** YYYY-MM-DD, last day a recurrence may run. Without it the recurrence runs until paused or cancelled. */
  @IsOptional() @IsDateString() recurrence_ends_on?: string;

  @IsOptional() @IsBoolean() send_email?: boolean;

  // Omitted classification fields inherit the company defaults.
  @IsOptional() @IsString() service_code?: string;
  @IsOptional() @IsString() municipality_code?: string;
  @IsOptional() @IsUUID() service_profile_id?: string;

  @IsOptional() @IsString() external_id?: string;
  @IsOptional() @IsString() idempotency_key?: string;
}

export class CompanyListInput {
  @IsOptional() @IsString() tax_id?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

export class CompanyCreateAddressInput {
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zip?: string;
}

export class CompanyCreateInput {
  @IsString() @IsNotEmpty() legal_name!: string;
  @IsString() @IsNotEmpty() tax_id!: string;
  @IsString()
  @IsIn(['mei', 'simple_national'])
  tax_regime!: string;
  @IsString() @IsNotEmpty() municipality_code!: string;
  @IsOptional() @IsString() trade_name?: string;
  @IsOptional() @IsString() municipal_reg?: string;
  @IsOptional() @IsBoolean() send_municipal_reg?: boolean;
  @IsOptional() @IsString() default_service_code?: string;
  @IsOptional() @IsBoolean() simple_national?: boolean;
  @IsOptional() @IsString() special_regime?: string;
  @IsOptional() @IsString() simples_rate?: string;
  @IsOptional() @IsString() simples_iss_rate?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyCreateAddressInput)
  address?: CompanyCreateAddressInput;
}

export class NfseQueryInput {
  @IsString() access_key!: string;
}

export class NfseListInput {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(1000) limit?: number;
  @IsOptional() @IsString() cursor?: string;
}

export class NfseDownloadPdfInput {
  @IsString() access_key!: string;
}

export class NfseGetDownloadUrlInput {
  @IsString() access_key!: string;
  @IsIn(['pdf', 'xml']) format!: 'pdf' | 'xml';
}

export class NfseCancelInput {
  @IsUUID() invoice_id!: string;
  @IsIn(CANCELLATION_REASON_CODES) reason!: CancellationReasonCode;
  @IsOptional()
  @IsString()
  @MaxLength(CANCELLATION_DESCRIPTION_MAX)
  description?: string;
}

export class NfseIssueBatchInput {
  /**
   * Items are NOT nested-validated here: each one is checked on its own by the
   * handler so a bad row is reported in place instead of failing the batch.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  invoices!: unknown[];
}

export class ScheduleListInput {
  @IsOptional()
  @IsIn(['active', 'paused', 'completed', 'cancelled'])
  status?: 'active' | 'paused' | 'completed' | 'cancelled';
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsNumber() @Min(0) offset?: number;
}

export class ScheduleIdInput {
  @IsUUID() schedule_id!: string;
}

export class ScheduleRunsInput extends ScheduleIdInput {
  @IsOptional() @IsNumber() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsNumber() @Min(0) offset?: number;
}

export class ScheduleUpdateInput extends ScheduleIdInput {
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) deduction?: number;
  /** Purchase order printed on the next notes; an empty text removes it. */
  @IsOptional() @IsString() @MaxLength(60) purchase_order?: string;
  /** Free text printed on the next notes; an empty text removes it. */
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInput)
  customer?: CustomerInput;
  @IsOptional() @IsBoolean() send_email?: boolean;
  @IsOptional() @IsString() service_code?: string;
  @IsOptional() @IsString() municipality_code?: string;
  /** YYYY-MM-DD, or null to remove the deadline. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  ends_on?: string | null;
  @IsOptional() @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY']) frequency?:
    'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  /** YYYY-MM-DD: moves the date the count of runs starts from. */
  @IsOptional() @IsDateString() first_date?: string;
}

/** The spreadsheet travels as text: csv as is, or an xlsx encoded in base64. Exactly one is required (checked by the handler). */
export class ImportCreateInput {
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() content_base64?: string;
  @IsOptional() @IsString() @MaxLength(255) file_name?: string;
  @IsOptional() @IsUUID() company_id?: string;
}

export class ImportListInput {
  @IsOptional() @IsInt() @Min(1) @Max(20) limit?: number;
}

export class ImportIdInput {
  @IsUUID() import_id!: string;
}

export class ImportRowsInput extends ImportIdInput {
  @IsOptional()
  @IsIn(['valid', 'invalid', 'queued', 'accepted', 'rejected'])
  status?: 'valid' | 'invalid' | 'queued' | 'accepted' | 'rejected';
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d{1,9}$/, { message: 'cursor must be a number' })
  cursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ImportFixRowInput extends ImportIdInput {
  @IsInt() @Min(1) line!: number;
  @IsObject() item!: Record<string, unknown>;
}
