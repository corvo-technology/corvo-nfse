import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';
import {
  AUDIT_ACTOR_TYPES,
  type AuditActorType,
} from '../domain/account-audit';

export class ListAuditEventsQuery extends CursorQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  override limit?: number = undefined;

  @ApiPropertyOptional({ enum: AUDIT_ACTOR_TYPES })
  @IsOptional()
  @IsIn(AUDIT_ACTOR_TYPES)
  actor_type?: AuditActorType;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
