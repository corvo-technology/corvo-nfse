import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorQuery } from './pagination';

/** The list looks back at most 30 days. */
export const MAX_DELIVERY_HOURS = 720;
export const WEBHOOK_DELIVERY_STATUS_FILTERS = [
  'pending',
  'sent',
  'delayed',
  'failed',
  'manual_retry',
] as const;

export class WebhookDeliveryQuery extends CursorQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : value,
  )
  @IsNumber()
  @Min(0.01)
  @Max(MAX_DELIVERY_HOURS)
  hours?: number;
  @IsOptional() @IsIn(['live', 'test']) environment?: 'live' | 'test';
  /** Only deliveries about this invoice. */
  @IsOptional() @IsUUID() invoice_id?: string;
  /** Only this event, e.g. `nfse.invoice.authorized`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9._]*$/)
  event_type?: string;
  @IsOptional() @IsIn(WEBHOOK_DELIVERY_STATUS_FILTERS) status?: string;
}
