import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEFAULT_ROWS_PAGE,
  MAX_ROWS_PAGE,
  type ImportRowStatus,
} from '../domain/import';

export class StartImportDto {
  @ApiPropertyOptional({
    description:
      'Company that issues every row that has no CNPJ column value. A row whose CNPJ differs from it is rejected.',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export type UploadedImportFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
};

export class ListImportRowsQuery {
  @ApiPropertyOptional({
    enum: ['valid', 'invalid', 'queued', 'accepted', 'rejected'],
  })
  @IsOptional()
  @IsIn(['valid', 'invalid', 'queued', 'accepted', 'rejected'])
  status?: ImportRowStatus;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d{1,9}$/, { message: 'cursor must be a number' })
  cursor?: string;

  @ApiPropertyOptional({ default: DEFAULT_ROWS_PAGE, maximum: MAX_ROWS_PAGE })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_ROWS_PAGE)
  limit?: number;
}

export class UpdateImportRowDto {
  @ApiPropertyOptional({
    description:
      'Fields of the invoice to change (same shape as POST /invoices).',
  })
  @IsObject()
  item!: Record<string, unknown>;
}

export class ListImportsQuery {
  @ApiPropertyOptional({ default: 10, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) =>
    value === '' ? undefined : value,
  )
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
