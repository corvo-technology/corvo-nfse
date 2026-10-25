import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CreateInvoiceDto } from './invoice.dto';

export const MAX_INVOICE_BATCH_SIZE = 50;

export class CreateInvoiceBatchDto {
  @ApiProperty({
    type: 'array',
    items: { $ref: '#/components/schemas/BatchInvoiceItemDto' },
    minItems: 1,
    maxItems: MAX_INVOICE_BATCH_SIZE,
    description:
      'Invoices to emit. Each item has the same fields as POST /invoices plus an optional idempotencyKey; items may belong to different companies. Items are validated one by one: an invalid item is rejected in the response without failing the others.',
  })
  // Items are intentionally NOT @ValidateNested: a bad item must never fail the batch.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVOICE_BATCH_SIZE)
  invoices!: unknown[];
}

export class BatchInvoiceItemDto extends CreateInvoiceDto {
  /** Per-item idempotency key. Repeating the batch with the same keys never issues twice. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}
