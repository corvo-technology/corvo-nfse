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
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NumericOption } from '@/shared/http/numeric-option';
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

export class NfcePaymentDto extends NfePaymentDto {}

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
  @NumericOption('indPres', [1, 4, 5])
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

  @ApiPropertyOptional({
    enum: ['offline'],
    description:
      'Issue in off-line contingency (`tpEmis` 9): the NFC-e is numbered, signed and returned at once (`201`, status `contingency_pending`, with `qrCode`, `xmlUrl` and `pdfUrl`) and Corvo transmits it when the SEFAZ answers, within 24 hours. Left out, the company option "issue off-line automatically" decides when the SEFAZ cannot be reached; without it the NFC-e goes the normal way (`202`).',
  })
  @IsOptional()
  @IsIn(['offline'])
  contingency?: 'offline';
}
