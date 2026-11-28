import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';
import type { NfeFiscalEvent, NfeInutilization } from '../domain/nfe-event';
import type { NfeNumberGap } from '../infra/typeorm-nfe-number-gaps.query';

/** The length rules (15 to 255, 15 to 1000) are checked by the service: they answer their own code. */
export class CancelNfeDto {
  @ApiProperty({
    minLength: 15,
    maxLength: 255,
    example: 'Pedido cancelado pelo cliente antes da entrega',
    description:
      'Why the NF-e is cancelled: 15 to 255 characters (`JUSTIFICATION_LENGTH`). Printable Latin-1 only.',
  })
  @IsString()
  @MaxLength(2000)
  justification!: string;
}

export class CorrectNfeDto {
  @ApiProperty({
    minLength: 15,
    maxLength: 1000,
    example: 'Corrigir o endereço de entrega para Rua das Flores, 20',
    description:
      'The correction to consider: 15 to 1000 characters (`CORRECTION_LENGTH`). It cannot change values, taxes, the parties or the dates.',
  })
  @IsString()
  @MaxLength(5000)
  correction!: string;
}

/** Body of `POST /v1/invoices/{id}/repeat` (MCP `nfe_repeat`): the note is copied as it is. */
export class RepeatNfeDto {
  @ApiPropertyOptional({
    maxLength: 5000,
    description: 'Replaces the additional information of the copied note.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  additionalInfo?: string;
}

export class InutilizeNfeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  companyId!: string;

  @ApiProperty({ minimum: 0, maximum: 999, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  series!: number;

  @ApiProperty({ minimum: 1, maximum: 999999999, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999999)
  start!: number;

  @ApiProperty({ minimum: 1, maximum: 999999999, example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999999)
  end!: number;

  @ApiProperty({
    minLength: 15,
    maxLength: 255,
    example: 'Numeração pulada por falha do sistema emissor',
  })
  @IsString()
  @MaxLength(2000)
  justification!: string;
}

export class ListInutilizationsQuery extends CursorQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this company.' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ enum: ['pending', 'homologada', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'homologada', 'rejected'])
  status?: 'pending' | 'homologada' | 'rejected';
}

export class NumberGapsQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this company.' })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

/** A cancellation or correction letter as the API shows it. The XML stays inside (a file, later). */
export function toNfeEventResponse(event: NfeFiscalEvent) {
  return {
    id: event.id,
    documentId: event.documentId,
    type: event.tpEvento === '110111' ? 'cancellation' : 'correction',
    tpEvento: event.tpEvento,
    sequence: event.nSeq,
    status: event.status,
    text: event.text,
    protocol: event.protocol,
    cStat: event.cStat,
    xMotivo: event.xMotivo,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function toNfeInutilizationResponse(inut: NfeInutilization) {
  return {
    id: inut.id,
    companyId: inut.companyId,
    environment: inut.environment,
    model: inut.model,
    series: inut.series,
    start: inut.start,
    end: inut.end,
    justification: inut.justification,
    status: inut.status,
    protocol: inut.protocol,
    cStat: inut.cStat,
    xMotivo: inut.xMotivo,
    createdAt: inut.createdAt,
    updatedAt: inut.updatedAt,
  };
}

export const toNfeNumberGapResponse = (gap: NfeNumberGap) => ({
  companyId: gap.companyId,
  series: gap.series,
  start: gap.start,
  end: gap.end,
});

/** One line of the timeline of an NF-e: a state it went through or a fiscal event. */
export interface NfeTimelineEntry {
  kind: 'status' | 'event';
  at: Date;
  status: string;
  from: string | null;
  tpEvento: string | null;
  sequence: number | null;
  eventId: string | null;
  /** The justification of a cancellation request or the text of a correction letter. */
  text: string | null;
  cStat: string | null;
  xMotivo: string | null;
}
