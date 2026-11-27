import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { OverviewPeriod } from '../domain/invoice-overview.repository';
import { InvoiceResponseDto } from './invoice-response.dto';

export class InvoiceOverviewQuery {
  @ApiPropertyOptional({ enum: ['7d', '30d'], default: '7d' })
  @IsIn(['7d', '30d'])
  period: OverviewPeriod = '7d';
}
class OverviewCountsDto {
  @ApiProperty({ description: 'NFS-e, NF-e and NFC-e authorized.' })
  authorized!: number;
  @ApiProperty({ description: 'Rejected (NF-e also denied).' })
  rejected!: number;
  @ApiProperty({ description: 'Queued and processing notes of every type.' })
  processing!: number;
}
class OverviewDayDto {
  @ApiProperty({ example: '2026-10-18' }) date!: string;
  @ApiProperty() count!: number;
}
/** A recent NF-e or NFC-e: the short line of the document. Read the whole one with `GET /invoices/{id}`. */
export class OverviewNfeItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['nfe', 'nfce'] }) type!: 'nfe' | 'nfce';
  @ApiProperty({ format: 'uuid' }) companyId!: string;
  @ApiProperty({ enum: ['test', 'live'] }) environment!: string;
  @ApiProperty({ description: 'NF-e status, e.g. `authorized` or `denied`.' })
  status!: string;
  @ApiProperty({ type: Number, nullable: true }) number!: number | null;
  @ApiProperty({ type: String, nullable: true }) accessKey!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Total of the note (`vNF`), a decimal text.',
    example: '150.00',
  })
  amount!: string | null;
  @ApiProperty({ type: String, nullable: true }) recipientName!: string | null;
  @ApiProperty({ type: String, nullable: true }) externalId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  authorizedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class InvoiceOverviewResponseDto {
  @ApiProperty({ enum: ['7d', '30d'] }) period!: OverviewPeriod;
  @ApiProperty({ example: '2026-10-12' }) from!: string;
  @ApiProperty({ example: '2026-10-18' }) to!: string;
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone!: string;
  @ApiProperty({ type: OverviewCountsDto }) counts!: OverviewCountsDto;
  @ApiProperty({ type: [OverviewDayDto] }) dailyActivity!: OverviewDayDto[];
  @ApiProperty({
    maxItems: 5,
    type: 'array',
    description:
      'The 5 newest notes of every type, told apart by `type`: an NFS-e is the whole invoice (`type: "nfse"`); an NF-e or NFC-e is a short line.',
    items: {
      oneOf: [
        { $ref: getSchemaPath(InvoiceResponseDto) },
        { $ref: getSchemaPath(OverviewNfeItemDto) },
      ],
    },
  })
  recentInvoices!: (InvoiceResponseDto | OverviewNfeItemDto)[];
}
