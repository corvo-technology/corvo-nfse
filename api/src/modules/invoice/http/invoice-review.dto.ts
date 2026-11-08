import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import {
  MAX_REVIEW_BATCH,
  REVIEW_ACTIONS,
  type ReviewAction,
} from '../application/invoice-review.service';

export class ReviewInvoicesDto {
  @IsIn(REVIEW_ACTIONS)
  @ApiProperty({
    enum: REVIEW_ACTIONS,
    description:
      'retry: send again with the same DPS (never issues twice). discard: reject only after the portal confirms the DPS was never registered.',
  })
  action!: ReviewAction;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REVIEW_BATCH)
  @IsUUID('all', { each: true })
  @ApiProperty({ type: [String], maxItems: MAX_REVIEW_BATCH })
  invoiceIds!: string[];
}
