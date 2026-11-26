import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const money = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

export class NfeAddressDto {
  @ApiProperty({ maxLength: 60, example: 'Rua das Flores' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  street!: string;

  @ApiProperty({ maxLength: 60, example: '10' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  number!: string;

  @ApiPropertyOptional({ maxLength: 60, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  complement?: string | null;

  @ApiProperty({ maxLength: 60, example: 'Centro' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  district!: string;

  @ApiProperty({ example: '01001000', description: 'CEP, 8 digits.' })
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/)
  zip!: string;

  @ApiProperty({ example: '3550308', description: 'IBGE code, 7 digits.' })
  @IsString()
  @Matches(/^\d{7}$/)
  cityCode!: string;

  @ApiProperty({ maxLength: 60, example: 'São Paulo' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  city!: string;

  @ApiProperty({ example: 'SP', minLength: 2, maxLength: 2 })
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  state!: string;
}

export class NfeRecipientDto {
  @ApiProperty({
    example: '123.456.789-09',
    description: 'CPF or CNPJ (the alphanumeric CNPJ is accepted).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(18)
  taxId!: string;

  @ApiProperty({ maxLength: 60, example: 'Maria da Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    enum: [1, 2, 9],
    description:
      '1 contributor (needs `stateRegistration`), 2 exempt, 9 non-contributor.',
  })
  @IsIn([1, 2, 9])
  indIeDest!: 1 | 2 | 9;

  @ApiPropertyOptional({ nullable: true, maxLength: 18 })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  stateRegistration?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 60 })
  @IsOptional()
  @IsEmail()
  @MaxLength(60)
  email?: string | null;

  @ApiProperty({ type: NfeAddressDto })
  @IsObject()
  @ValidateNested()
  @Type(() => NfeAddressDto)
  address!: NfeAddressDto;
}

export class NfeItemTaxDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 8 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  origin?: number;

  @ApiPropertyOptional({ enum: ['102', '400'] })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}$/)
  csosn?: string;

  @ApiPropertyOptional({ example: '49' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/)
  pisCst?: string;

  @ApiPropertyOptional({ example: '49' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/)
  cofinsCst?: string;
}

export class NfeItemDto {
  @ApiProperty({ maxLength: 60, example: 'SKU1' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  code!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'GTIN, or leave out for "SEM GTIN".',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{8}|\d{12}|\d{13}|\d{14})$/)
  gtin?: string | null;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  description!: string;

  @ApiProperty({ example: '61091000', description: 'NCM, 8 digits.' })
  @IsString()
  @MaxLength(20)
  ncm!: string;

  @ApiPropertyOptional({ nullable: true, example: '2806400' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{7}$/)
  cest?: string | null;

  @ApiProperty({ example: '5102', description: 'CFOP, 4 digits.' })
  @IsString()
  @MaxLength(20)
  cfop!: string;

  @ApiProperty({ maxLength: 6, example: 'UN' })
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  unit!: string;

  @ApiProperty({ description: 'Up to 4 decimals.', example: 2 })
  @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false })
  @Min(0.0001)
  @Max(99999999999)
  quantity!: number;

  @ApiProperty({ description: 'Up to 10 decimals.', example: 10 })
  @IsNumber({ maxDecimalPlaces: 10, allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(99999999999)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Up to 2 decimals.' })
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'Up to 2 decimals.' })
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  freight?: number;

  @ApiPropertyOptional({ description: 'Up to 2 decimals.' })
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  insurance?: number;

  @ApiPropertyOptional({ description: 'Up to 2 decimals.' })
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  other?: number;

  @ApiPropertyOptional({
    type: NfeItemTaxDto,
    description:
      'Left out, the Simples defaults of the company apply (ICMSSN102, PIS/COFINS CST 49).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NfeItemTaxDto)
  tax?: NfeItemTaxDto;
}

export class NfePaymentDto {
  @ApiProperty({
    example: '17',
    description: 'Payment means (tPag), 2 digits.',
  })
  @IsString()
  @Matches(/^\d{2}$/)
  tPag!: string;

  @ApiProperty({ description: 'Up to 2 decimals.', example: 20 })
  @IsNumber(money)
  @Min(0)
  amount!: number;
}

/** Body of `POST /v1/invoices/validate` (and, later, `POST /v1/invoices` (`type: "nfe"`)). */
export class NfeRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  companyId!: string;

  @ApiPropertyOptional({
    maxLength: 60,
    description: 'Defaults to the one of the company.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  natOp?: string;

  @ApiPropertyOptional({ enum: [1], default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  finNfe?: number;

  @ApiPropertyOptional({
    enum: [1, 2],
    default: 1,
    description: 'DANFE layout: 1 portrait, 2 landscape.',
  })
  @IsOptional()
  @IsIn([1, 2])
  tpImp?: number;

  @ApiProperty({ type: NfeRecipientDto })
  @IsObject()
  @ValidateNested()
  @Type(() => NfeRecipientDto)
  recipient!: NfeRecipientDto;

  @ApiProperty({ type: [NfeItemDto], minItems: 1, maxItems: 990 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(990)
  @ValidateNested({ each: true })
  @Type(() => NfeItemDto)
  items!: NfeItemDto[];

  @ApiProperty({ type: [NfePaymentDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NfePaymentDto)
  payments!: NfePaymentDto[];

  @ApiPropertyOptional({ description: 'Change (vTroco), up to 2 decimals.' })
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  change?: number;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  additionalInfo?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalId?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Send the XML and the DANFE to the e-mail of the recipient once the NF-e is authorized. Only when the recipient has an e-mail; never in the dry-run.',
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
