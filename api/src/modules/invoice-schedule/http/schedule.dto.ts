import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';
import type { InvoiceSchedule } from '../domain/invoice-schedule';

export class ScheduleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['once', 'recurring'] }) kind!: string;
  @ApiProperty({ enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'], nullable: true })
  frequency!: string | null;
  @ApiProperty({ enum: ['active', 'paused', 'completed', 'cancelled'] })
  status!: string;
  @ApiProperty({ enum: ['customer', 'failures'], nullable: true })
  pause_reason!: string | null;
  @ApiProperty() company_id!: string;
  @ApiProperty({ example: '2026-11-09' }) anchor_on!: string;
  @ApiProperty({ example: '2026-11-09', nullable: true })
  next_run_on!: string | null;
  @ApiProperty({ nullable: true }) ends_on!: string | null;
  @ApiProperty({
    description: 'Failed attempts in a row on the pending run (0 to 3).',
  })
  attempts!: number;
  @ApiProperty({ nullable: true }) last_run_on!: string | null;
  @ApiProperty({ description: 'The invoice body each run issues.' })
  invoice!: Record<string, unknown>;
  @ApiProperty() created_at!: string;
}

export function toScheduleResponse(
  schedule: InvoiceSchedule,
): ScheduleResponseDto {
  const p = schedule.props;
  return {
    id: p.id,
    kind: p.kind,
    frequency: p.frequency,
    status: p.status,
    pause_reason: p.pauseReason,
    company_id: p.companyId,
    anchor_on: p.anchorOn,
    next_run_on: p.nextRunOn,
    ends_on: p.endsOn,
    attempts: p.attempts,
    last_run_on: p.lastRunOn,
    invoice: p.invoiceInput,
    created_at: p.createdAt.toISOString(),
  };
}

export class ScheduleRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    example: '2026-11-07',
    description: 'The due date (may be a weekend day).',
  })
  occurrence_on!: string;
  @ApiProperty({
    example: '2026-11-09',
    description: 'The day it actually ran.',
  })
  ran_on!: string;
  @ApiProperty() attempt!: number;
  @ApiProperty({ enum: ['issued', 'failed'] }) outcome!: string;
  @ApiProperty({ nullable: true }) invoice_id!: string | null;
  @ApiProperty({ nullable: true }) error_code!: string | null;
  @ApiProperty({ nullable: true }) error_message!: string | null;
  @ApiProperty() created_at!: string;
}

export class ListSchedulesQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: ['active', 'paused', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['active', 'paused', 'completed', 'cancelled'])
  status?: 'active' | 'paused' | 'completed' | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({
    description:
      'Invoice body fields to change; merged over the stored body and validated like an emission.',
  })
  @IsOptional()
  @IsObject()
  invoice?: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true, example: '2027-06-30' })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString()
  endsOn?: string | null;

  @ApiPropertyOptional({ enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] })
  @IsOptional()
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  frequency?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsDateString()
  anchorOn?: string;
}
