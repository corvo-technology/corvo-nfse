import {
  IsArray,
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsString() name!: string;
  @IsString() tax_id!: string;
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
  @IsUUID()
  company_id!: string;

  @ValidateNested()
  @Type(() => CustomerInput)
  customer!: CustomerInput;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceInput)
  services!: ServiceInput[];

  @IsDateString()
  competence_date!: string;

  // Omitted classification fields inherit the company defaults.
  @IsOptional() @IsString() service_code?: string;
  @IsOptional() @IsString() municipality_code?: string;

  @IsOptional() @IsString() idempotency_key?: string;
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
