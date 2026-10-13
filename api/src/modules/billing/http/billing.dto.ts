import { IsIn, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty({ enum: ['developer', 'growth', 'scale', 'volume'] })
  @IsIn(['developer', 'growth', 'scale', 'volume'])
  plan_slug!: string;
}
export class ChangePlanDto {
  @ApiProperty({ enum: ['free', 'developer', 'growth', 'scale', 'volume'] })
  @IsIn(['free', 'developer', 'growth', 'scale', 'volume'])
  plan_slug!: string;
}
export class CheckoutSessionParams {
  @IsString() @MaxLength(255) sessionId!: string;
}
