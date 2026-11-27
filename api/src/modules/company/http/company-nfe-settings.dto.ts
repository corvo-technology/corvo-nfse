import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateCompanyNfeSettingsDto {
  @ApiPropertyOptional({
    example: '110042490114',
    description:
      'State registration (IE) of the company, digits (dots and dashes are accepted). Validated for the state of the company; `ISENTO` is not valid for an issuer. Leave it out to use the IE the SEFAZ has for the CNPJ (when there is exactly one enabled; else 422 `STATE_REGISTRATION_REQUIRED`).',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(18)
  stateRegistration?: string;

  @ApiPropertyOptional({
    enum: [1, 4],
    description:
      'Tax regime code (CRT). Leave it out: it follows the tax regime of the company (Simples Nacional is 1, MEI is 4). Only send it to override.',
  })
  @IsOptional()
  @IsIn([1, 4])
  crt?: 1 | 4;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 999,
    default: 1,
    description: 'Series used by default on new NF-e.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  defaultSeries?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 999,
    default: 1,
    description:
      'Series used by default on new NFC-e (apart from the NF-e one).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  nfceDefaultSeries?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Issue the NFC-e off-line (contingency, tpEmis 9) by itself when the SEFAZ cannot be reached. Off by default: a note issued off-line can still be rejected afterwards.',
  })
  @IsOptional()
  @IsBoolean()
  nfceAutoOffline?: boolean;

  @ApiPropertyOptional({
    default: 'Venda de mercadoria',
    maxLength: 60,
    description:
      'Nature of the operation used when the NF-e does not send one.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  defaultNatOp?: string;

  @ApiPropertyOptional({
    enum: ['102', '400'],
    default: '102',
    description: 'Default CSOSN of the items (Simples Nacional, no credit).',
  })
  @IsOptional()
  @IsIn(['102', '400'])
  defaultCsosn?: '102' | '400';

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 8,
    default: 0,
    description: 'Default origin of the goods.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  defaultOrigin?: number;

  @ApiPropertyOptional({
    enum: ['49'],
    default: '49',
    description: 'Default PIS CST (zeroed group, Simples Nacional).',
  })
  @IsOptional()
  @Matches(/^49$/)
  defaultPisCst?: string;

  @ApiPropertyOptional({
    enum: ['49'],
    default: '49',
    description: 'Default COFINS CST (zeroed group, Simples Nacional).',
  })
  @IsOptional()
  @Matches(/^49$/)
  defaultCofinsCst?: string;
}
