import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { OverviewPeriod } from '../domain/invoice-overview.repository';
import { InvoiceResponseDto } from './invoice-response.dto';

export class InvoiceOverviewQuery {
  @ApiPropertyOptional({ enum: ['7d', '30d'], default: '7d' })
  @IsIn(['7d', '30d'])
  period: OverviewPeriod = '7d';
}
class OverviewCountsDto {
  @ApiProperty() authorized!: number;
  @ApiProperty() rejected!: number;
  @ApiProperty({ description: 'Queued and processing invoices.' })
  processing!: number;
}
class OverviewDayDto {
  @ApiProperty({ example: '2026-10-18' }) date!: string;
  @ApiProperty() count!: number;
}
export class InvoiceOverviewResponseDto {
  @ApiProperty({ enum: ['7d', '30d'] }) period!: OverviewPeriod;
  @ApiProperty({ example: '2026-10-12' }) from!: string;
  @ApiProperty({ example: '2026-10-18' }) to!: string;
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone!: string;
  @ApiProperty({ type: OverviewCountsDto }) counts!: OverviewCountsDto;
  @ApiProperty({ type: [OverviewDayDto] }) dailyActivity!: OverviewDayDto[];
  @ApiProperty({ type: [InvoiceResponseDto], maxItems: 5 })
  recentInvoices!: InvoiceResponseDto[];
}
