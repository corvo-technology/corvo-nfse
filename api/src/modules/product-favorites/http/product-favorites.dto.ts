import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveProductFavoriteDto {
  @ApiProperty({ maxLength: 120, example: 'Camiseta algodão' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  description!: string;

  @ApiPropertyOptional({
    maxLength: 60,
    description: 'Your own product code.',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  code?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Barcode, 8 to 14 digits.',
  })
  @IsOptional()
  @Matches(/^\d{8}$|^\d{12,14}$/)
  gtin?: string | null;

  @ApiProperty({ example: '61091000', description: 'NCM, 8 digits.' })
  @Matches(/^\d{8}$/)
  ncm!: string;

  @ApiPropertyOptional({ nullable: true, description: 'CEST, 7 digits.' })
  @IsOptional()
  @Matches(/^\d{7}$/)
  cest?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '5102' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  cfop?: string | null;

  @ApiPropertyOptional({ maxLength: 6, example: 'UN' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  unit?: string;

  @ApiProperty({ example: 49.9, description: 'Price of one unit, in reais.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999999)
  unitPrice!: number;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['102', '400'],
    description: 'Leave out to follow the company.',
  })
  @IsOptional()
  @IsIn(['102', '400'])
  csosn?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  origin?: number | null;
}
