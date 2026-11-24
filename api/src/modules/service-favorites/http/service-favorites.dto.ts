import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateServiceFavoriteDto {
  @ApiProperty({ maxLength: 80, example: 'Mensalidade' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ maxLength: 2000 })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ example: '010101', description: 'cTribNac, 6 digits.' })
  @Matches(/^\d{6}$/)
  serviceCode!: string;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    nullable: true,
    description: 'Default amount in cents.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '3550308',
    description: 'Place of service (7 digits).',
  })
  @IsOptional()
  @Matches(/^\d{7}$/)
  municipalityCode?: string | null;
}
