import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

type Body = CreateServiceFavoriteDto;
const isService = (o: Body) => o.kind !== 'product';
const isProduct = (o: Body) => o.kind === 'product';
/** A product field that was sent (null or left out is fine). */
const sentOnProduct = (o: Body, value: unknown) =>
  isProduct(o) && value !== undefined && value !== null;

export const PRODUCT_DESCRIPTION_MAX = 120;

/** A favorite service (default) or a favorite product (`kind: "product"`). */
export class CreateServiceFavoriteDto {
  @ApiPropertyOptional({
    enum: ['service', 'product'],
    default: 'service',
    description:
      'A `service` (fills the NFS-e) or a `product` (fills the NF-e and NFC-e items).',
  })
  @IsOptional()
  @IsIn(['service', 'product'])
  kind?: 'service' | 'product';

  @ApiPropertyOptional({
    maxLength: 80,
    example: 'Mensalidade',
    description:
      'Short name. Required for a service; a product uses its description.',
  })
  @ValidateIf(isService)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiProperty({
    maxLength: 2000,
    description: `Service description, or the product name (up to ${PRODUCT_DESCRIPTION_MAX} characters).`,
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({
    example: '010101',
    description: 'cTribNac, 6 digits. Required for a service.',
  })
  @ValidateIf(isService)
  @Matches(/^\d{6}$/)
  serviceCode?: string;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int64',
    minimum: 1,
    nullable: true,
    description: 'Service: default amount in cents.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '3550308',
    description: 'Service: place of service (7 digits).',
  })
  @IsOptional()
  @Matches(/^\d{7}$/)
  municipalityCode?: string | null;

  @ApiPropertyOptional({
    maxLength: 60,
    description: 'Product: your own product code.',
  })
  @ValidateIf(sentOnProduct)
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  code?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Product: barcode, 8 to 14 digits.',
  })
  @ValidateIf(sentOnProduct)
  @Matches(/^\d{8}$|^\d{12,14}$/)
  gtin?: string | null;

  @ApiPropertyOptional({
    example: '61091000',
    description: 'Product: NCM, 8 digits. Required for a product.',
  })
  @ValidateIf(isProduct)
  @Matches(/^\d{8}$/)
  ncm?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Product: CEST, 7 digits.',
  })
  @ValidateIf(sentOnProduct)
  @Matches(/^\d{7}$/)
  cest?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '5102' })
  @ValidateIf(sentOnProduct)
  @Matches(/^\d{4}$/)
  cfop?: string | null;

  @ApiPropertyOptional({ maxLength: 6, example: 'UN' })
  @ValidateIf(sentOnProduct)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  unit?: string | null;

  @ApiPropertyOptional({
    example: 49.9,
    description:
      'Product: price of one unit, in reais. Required for a product.',
  })
  @ValidateIf(isProduct)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99999999999)
  unitPrice?: number;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['102', '400'],
    description: 'Product: CSOSN. Leave out to follow the company.',
  })
  @ValidateIf(sentOnProduct)
  @IsIn(['102', '400'])
  csosn?: string | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 8 })
  @ValidateIf(sentOnProduct)
  @IsInt()
  @Min(0)
  @Max(8)
  origin?: number | null;
}
