import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  NfeAddressDto,
  NfeItemDto,
  NfePaymentDto,
} from '@/modules/nfe/http/nfe.dto';

const money = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false };

/** The consumer of a NFC-e. Every field is optional: a sale may be anonymous. */
export class NfceRecipientDto {
  @ApiPropertyOptional({
    example: '123.456.789-09',
    description:
      'CPF or CNPJ of the consumer. Required from the limit of the state (R$ 10.000,00 by default).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(18)
  taxId?: string;

  @ApiPropertyOptional({ maxLength: 60, example: 'Maria da Silva' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsEmail()
  @MaxLength(60)
  email?: string;

  @ApiPropertyOptional({
    type: NfeAddressDto,
    description: 'Required for a delivery sale (`indPres` 4).',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NfeAddressDto)
  address?: NfeAddressDto;
}

/** The `card` group: cards, PIX and other electronic payments. */
export class NfceCardDto {
  @ApiPropertyOptional({
    enum: [1, 2],
    default: 2,
    description:
      '1 payment integrated with the sales system (needs `cnpj` and `cAut`), 2 not integrated.',
  })
  @IsOptional()
  @IsIn([1, 2])
  tpIntegra?: 1 | 2;

  @ApiPropertyOptional({ description: 'CNPJ of the payment institution.' })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  cnpj?: string;

  @ApiPropertyOptional({
    example: '01',
    description: 'Card brand, 2 digits (table of the NT).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/)
  tBand?: string;

  @ApiPropertyOptional({ description: 'Authorization number.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  cAut?: string;
}

export class NfcePaymentDto extends NfePaymentDto {
  @ApiPropertyOptional({
    type: NfceCardDto,
    description: 'Only with `tPag` 03, 04 or 17.',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NfceCardDto)
  card?: NfceCardDto;
}

/**
 * Body of `POST /v1/invoices/validate` with `type: "nfce"`. There is no `natOp`, `finNfe` or
 * transport: the NFC-e is always a normal sale to the final consumer, and the validation pipe
 * refuses any field that is not here.
 */
export class NfceRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  companyId!: string;

  @ApiPropertyOptional({ type: NfceRecipientDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NfceRecipientDto)
  recipient?: NfceRecipientDto;

  @ApiPropertyOptional({
    enum: [1, 4, 5],
    default: 1,
    description:
      'Buyer presence: 1 in person, 4 delivery (needs the consumer CPF/CNPJ, name and address), 5 in person outside the issuer establishment.',
  })
  @IsOptional()
  @IsIn([1, 4, 5])
  indPres?: 1 | 4 | 5;

  @ApiProperty({ type: [NfeItemDto], minItems: 1, maxItems: 990 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(990)
  @ValidateNested({ each: true })
  @Type(() => NfeItemDto)
  items!: NfeItemDto[];

  @ApiProperty({ type: [NfcePaymentDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NfcePaymentDto)
  payments!: NfcePaymentDto[];

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
      'Send the XML and the DANFCE to the e-mail of the consumer once the NFC-e is authorized. Only when there is an e-mail; never in the dry-run.',
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}
