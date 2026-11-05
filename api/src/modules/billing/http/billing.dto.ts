import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAID_PLANS = ['solo', 'equipe', 'empresa', 'escala'] as const;

export class AddressDto {
  @IsString() @MaxLength(12) zipcode!: string;
  @IsString() @MaxLength(120) street!: string;
  @IsString() @MaxLength(20) number!: string;
  @IsString() @MaxLength(80) neighborhood!: string;
  @IsString() @MaxLength(80) city!: string;
  @IsString() @MaxLength(2) state!: string;
  @IsOptional() @IsString() @MaxLength(60) complement?: string;
}

export class PayerDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(20) taxID!: string;
  @IsString() @MaxLength(200) email!: string;
  @IsString() @MaxLength(30) phone!: string;
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

/** Plan or avulso notes, paid with Pix (Woovi) or card (Stripe). */
export class CheckoutDto {
  @ApiPropertyOptional({ enum: ['plan', 'avulso'], default: 'plan' })
  @IsOptional()
  @IsIn(['plan', 'avulso'])
  kind?: 'plan' | 'avulso';

  @ApiPropertyOptional({ enum: PAID_PLANS })
  @IsOptional()
  @IsIn(PAID_PLANS)
  plan_slug?: (typeof PAID_PLANS)[number];

  @ApiPropertyOptional({ enum: ['monthly', 'annual'], default: 'monthly' })
  @IsOptional()
  @IsIn(['monthly', 'annual'])
  cycle?: 'monthly' | 'annual';

  @ApiPropertyOptional({ description: 'Notes to buy (avulso), minimum 3' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  units?: number;

  @ApiPropertyOptional({ enum: ['pix', 'card'], default: 'card' })
  @IsOptional()
  @IsIn(['pix', 'card'])
  method?: 'pix' | 'card';

  @ApiPropertyOptional({ description: 'Payer data, required for monthly Pix' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayerDto)
  customer?: PayerDto;
}
export class ChangePlanDto {
  @ApiProperty({ enum: ['free', ...PAID_PLANS] })
  @IsIn(['free', ...PAID_PLANS])
  plan_slug!: string;
}
export class CheckoutSessionParams {
  @IsString() @MaxLength(255) sessionId!: string;
}
