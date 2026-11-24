import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceResponseDto } from './invoice-response.dto';

export class InvoiceBatchErrorDto {
  @ApiProperty({ example: 'ERROR_VALIDATION' }) code!: string;
  @ApiProperty({ example: 'Request validation failed' }) message!: string;
  @ApiPropertyOptional({
    description:
      'Field-level details, when the error has them (a list of issues for validation errors).',
    oneOf: [{ type: 'array', items: { type: 'object' } }, { type: 'object' }],
  })
  details?: unknown;
}

export class InvoiceBatchResultDto {
  @ApiProperty({
    example: 0,
    description: 'Position of the item in the request, starting at 0.',
  })
  index!: number;

  @ApiProperty({ enum: ['accepted', 'rejected'] })
  status!: 'accepted' | 'rejected';

  @ApiPropertyOptional({
    description:
      'True when the item repeated an idempotencyKey already saved with the same payload: the existing invoice is returned and nothing new is written.',
  })
  replayed?: true;

  @ApiPropertyOptional({
    type: InvoiceResponseDto,
    description: 'Present when status is accepted.',
  })
  invoice?: InvoiceResponseDto;

  @ApiPropertyOptional({
    type: InvoiceBatchErrorDto,
    description:
      'Present when status is rejected. Rejected items are not saved.',
  })
  error?: InvoiceBatchErrorDto;
}

export class InvoiceBatchSummaryDto {
  @ApiProperty({ example: 50 }) total!: number;
  @ApiProperty({ example: 48 }) accepted!: number;
  @ApiProperty({ example: 2 }) rejected!: number;

  @ApiProperty({
    type: [InvoiceBatchResultDto],
    description: 'One entry per request item, in the order they were sent.',
  })
  results!: InvoiceBatchResultDto[];
}
