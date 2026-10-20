import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { InvoiceStatus } from '../domain/invoice-status';
import {
  CANCELLATION_REASON_CODES,
  type CancellationReasonCode,
} from '../domain/cancellation-reason';
import type { LastEmailStatus } from '../domain/invoice';

export class CustomerSnapshotDto {
  @ApiPropertyOptional({
    description: 'Absent for anonymous consumer invoices.',
  })
  taxId?: string;

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

  @ApiPropertyOptional({
    description: 'RTC fiscal classification (nbsCode, cst, classCode, ...).',
  })
  fiscal?: Record<string, string>;

  @ApiPropertyOptional()
  serviceProfileId?: string;

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

  @ApiPropertyOptional({
    type: CustomerSnapshotDto,
    nullable: true,
    description:
      'Null for anonymous consumer invoices (tomador omitted from the DPS).',
  })
  customerSnapshot?: CustomerSnapshotDto | null;

  @ApiProperty()
  serviceSnapshot!: ServiceSnapshotDto;

  @ApiProperty()
  taxSnapshot!: Record<string, unknown>;

  @ApiProperty()
  amount!: number;

  @ApiPropertyOptional({
    description: 'Unconditional discount applied to the amount.',
  })
  discount?: number;

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

  @ApiPropertyOptional({
    enum: CANCELLATION_REASON_CODES,
    nullable: true,
    description: 'Reason given when the cancellation was requested',
  })
  cancellationReason?: CancellationReasonCode | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Justification given when the cancellation was requested',
  })
  cancellationDescription?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the invoice reached cancelled',
  })
  cancelledAt?: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Set when the cancellation was requested while the invoice was being issued (processing); it is cancelled at the Sefin as soon as it is authorized',
  })
  cancellationRequestedAt?: Date | null;

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
