import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  /** YYYY-MM-DD. Defaults to today (America/Sao_Paulo). */
  @IsOptional() @IsDateString() competence_date?: string;

  @IsOptional() @IsIn(['IMMEDIATE', 'SCHEDULE']) emission_type?:
    | 'IMMEDIATE'
    | 'SCHEDULE';

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

export class NfseCancelInput {
  @IsUUID() invoice_id!: string;
  @IsIn(CANCELLATION_REASON_CODES) reason!: CancellationReasonCode;
  @IsOptional()
  @IsString()
  @MaxLength(CANCELLATION_DESCRIPTION_MAX)
  description?: string;
}
