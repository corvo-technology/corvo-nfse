import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { INVOICE_STATUSES, type InvoiceStatus } from '../domain/invoice-status';
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

  @ApiPropertyOptional({
    description:
      'Customer outside Brazil: taxId (NIF) or noTaxIdReason, and the address abroad.',
  })
  foreign?: Record<string, string>;
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

  @ApiPropertyOptional({ description: 'Customer purchase order (DPS xPed).' })
  purchaseOrder?: string;

  @ApiPropertyOptional({
    description:
      'Complementary information printed on the invoice (DPS xInfComp).',
  })
  notes?: string;
}

const ISO = { type: String, format: 'date-time' } as const;

/**
 * The invoice as the API returns it: the stored fields (never the request hash)
 * plus the derived `documentsStatus`, `emailStatus` and `stage`.
 */
export class InvoiceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({
    enum: ['test', 'live'],
    description: 'Environment the invoice was issued in.',
  })
  environment!: 'test' | 'live';

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Your own reference, sent as `externalId` on creation.',
  })
  externalId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The `Idempotency-Key` the invoice was created with.',
  })
  idempotencyKey!: string | null;

  @ApiProperty({
    enum: INVOICE_STATUSES,
    description:
      'Fiscal status. `queued` and `processing` are in flight; `retry_pending`, `reconciliation_required` and `manual_review` are unresolved emissions (see POST /invoices/review); `authorized`, `rejected`, `failed` and `cancelled` are final; `cancelling` is an authorized invoice whose cancellation event is being processed.',
  })
  status!: InvoiceStatus;

  @ApiProperty({
    enum: ['pending', 'ready'],
    description: 'Whether the PDF and XML can be downloaded.',
  })
  documentsStatus!: 'pending' | 'ready';

  @ApiProperty({
    enum: ['queued', 'sent', 'failed'],
    nullable: true,
    description: 'Null when no e-mail was requested yet.',
  })
  emailStatus!: LastEmailStatus | null;

  @ApiProperty({
    enum: [
      'pending',
      'authorized',
      'documents_ready',
      'completed',
      'failed',
      'cancelled',
    ],
    description:
      'Single lifecycle view derived from the other fields: `completed` means authorized, documents ready and the requested e-mail resolved.',
  })
  stage!: string;

  @ApiProperty({
    type: CustomerSnapshotDto,
    nullable: true,
    description:
      'Null for anonymous consumer invoices (tomador omitted from the DPS).',
  })
  customerSnapshot!: CustomerSnapshotDto | null;

  @ApiProperty({ type: ServiceSnapshotDto })
  serviceSnapshot!: ServiceSnapshotDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Calculated taxes. Its keys depend on the tax regime and may grow; use POST /invoices/calculate to preview them.',
  })
  taxSnapshot!: Record<string, unknown>;

  @ApiProperty({ description: 'Gross amount in BRL (2 decimals).' })
  amount!: number;

  @ApiPropertyOptional({
    description: 'Unconditional discount applied to the amount.',
  })
  discount?: number;

  @ApiPropertyOptional({
    description: 'Deduction from the ISS tax base declared by the issuer.',
  })
  deduction?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'On a substitute: the invoice it replaces.',
  })
  substitutesInvoiceId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  substitutionDescription?: string | null;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiProperty(ISO)
  competenceDate!: Date;

  @ApiPropertyOptional({ ...ISO, nullable: true })
  scheduledFor?: Date | null;

  @ApiProperty({ type: String, nullable: true })
  dpsId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  dpsSeries!: string | null;

  @ApiProperty({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    nullable: true,
    description:
      'The DPS number, a JSON integer (at most 15 digits, within the safe integer range of JavaScript). The leading zeros of the printed number are not kept.',
  })
  dpsNumber!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'NFS-e access key (50 digits), once authorized.',
  })
  accessKey!: string | null;

  @ApiProperty({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    nullable: true,
    description:
      'The NFS-e number, a JSON integer (at most 15 digits, within the safe integer range of JavaScript). The leading zeros of the printed number are not kept.',
  })
  nfseNumber!: number | null;

  @ApiProperty()
  fiscalProvider!: string;

  @ApiProperty()
  fiscalSchemaVersion!: string;

  @ApiProperty({ ...ISO, nullable: true })
  issuedAt!: Date | null;

  @ApiProperty({ ...ISO, nullable: true })
  authorizedAt!: Date | null;

  @ApiPropertyOptional({
    type: 'object',
    properties: { send: { type: 'boolean' } },
    description: 'Whether the e-mail to the customer was requested.',
  })
  emailSnapshot?: { send?: boolean };

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Rejection or failure code of the last attempt: an `E`-prefixed Sefin rule (E0014) or one of Corvo (DPS_NUMBER_ALREADY_USED, DPS_NUMBER_BELOW_CURRENT, ...).',
  })
  lastErrorCode!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorMessage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastErrorProvider!: string | null;

  @ApiProperty({ ...ISO, nullable: true })
  documentsReadyAt!: Date | null;

  @ApiProperty({ enum: ['queued', 'sent', 'failed'], nullable: true })
  lastEmailStatus!: LastEmailStatus | null;

  @ApiProperty({ ...ISO, nullable: true })
  lastEmailSentAt!: Date | null;

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
    ...ISO,
    nullable: true,
    description: 'When the invoice reached cancelled',
  })
  cancelledAt?: Date | null;

  @ApiPropertyOptional({
    ...ISO,
    nullable: true,
    description:
      'Set when the cancellation was requested while the invoice was being issued (processing); it is cancelled at the Sefin as soon as it is authorized',
  })
  cancellationRequestedAt?: Date | null;

  @ApiPropertyOptional({
    enum: ['taker_rejected', 'blocked'],
    nullable: true,
    description:
      'What the national portal reported after authorization (customer rejected the invoice, or the portal blocked it).',
  })
  portalFlag?: 'taker_rejected' | 'blocked' | null;

  @ApiProperty(ISO)
  createdAt!: Date;

  @ApiProperty(ISO)
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

  @ApiPropertyOptional({
    enum: ['portal'],
    nullable: true,
    description:
      '`portal` when the entry reports something the national portal registered; otherwise null.',
  })
  source?: 'portal' | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Portal event type, such as REJEICAO_TOMADOR.',
  })
  portalEvent?: string | null;
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
