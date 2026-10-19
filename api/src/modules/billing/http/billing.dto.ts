import { IsIn, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PAID_PLAN_SLUGS } from '@/modules/plans/domain/plan';

export class CheckoutDto {
  @ApiProperty({ enum: PAID_PLAN_SLUGS })
  @IsIn(PAID_PLAN_SLUGS)
  plan_slug!: string;
}
export class ChangePlanDto {
  @ApiProperty({ enum: ['free', ...PAID_PLAN_SLUGS] })
  @IsIn(['free', ...PAID_PLAN_SLUGS])
  plan_slug!: string;
}
export class CheckoutSessionParams {
  @IsString() @MaxLength(255) sessionId!: string;
}
