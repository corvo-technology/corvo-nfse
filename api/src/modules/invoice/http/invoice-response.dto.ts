import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { InvoiceStatus } from '../domain/invoice-status';
import type { LastEmailStatus } from '../domain/invoice';

export class CustomerSnapshotDto {
  @ApiProperty()
  taxId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  address?: {
    city: string;
    state: string;
    country?: string;
  };
}

export class ServiceSnapshotDto {
  @ApiProperty()
  description!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  municipalityCode!: string;
}

export class InvoiceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiPropertyOptional()
  externalId?: string;

  @ApiPropertyOptional()
  idempotencyKey?: string;

  @ApiProperty()
  status!: InvoiceStatus;

  @ApiProperty()
  customerSnapshot!: CustomerSnapshotDto;

  @ApiProperty()
  serviceSnapshot!: ServiceSnapshotDto;

  @ApiProperty()
  taxSnapshot!: Record<string, unknown>;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  competenceDate!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  scheduledFor?: Date | null;

  @ApiPropertyOptional()
  dpsId?: string;

  @ApiPropertyOptional()
  dpsSeries?: string;

  @ApiPropertyOptional()
  dpsNumber?: number;

  @ApiPropertyOptional()
  accessKey?: string;

  @ApiPropertyOptional()
  nfseNumber?: number;

  @ApiProperty()
  fiscalProvider!: string;

  @ApiProperty()
  fiscalSchemaVersion!: string;

  @ApiPropertyOptional()
  issuedAt?: Date;

  @ApiPropertyOptional()
  authorizedAt?: Date;

  @ApiPropertyOptional()
  lastErrorCode?: string;

  @ApiPropertyOptional()
  lastErrorMessage?: string;

  @ApiPropertyOptional()
  lastErrorProvider?: string;

  @ApiProperty()
  documentsReady!: boolean;

  @ApiPropertyOptional()
  lastEmail?: {
    status: LastEmailStatus;
    sentAt: Date | null;
  };

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class InvoiceEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  invoiceId!: string;

  @ApiPropertyOptional()
  fromStatus?: InvoiceStatus;

  @ApiProperty()
  toStatus!: InvoiceStatus;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty()
  createdAt!: Date;
}

export class InvoiceStatusResponseDto {
  @ApiProperty()
  status!: InvoiceStatus;

  @ApiPropertyOptional()
  error?: {
    code?: string;
    message?: string;
    provider?: string;
  };
}
