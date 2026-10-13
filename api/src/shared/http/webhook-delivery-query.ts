import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { CursorQuery } from './pagination';
export class WebhookDeliveryQuery extends CursorQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : value,
  )
  @IsNumber()
  @Min(0.01)
  hours?: number;
  @IsOptional() @IsIn(['live', 'test']) environment?: 'live' | 'test';
}
