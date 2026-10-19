import { IsIn, IsOptional, IsString } from 'class-validator';

export const TURNSTILE_PROOF_ACTIONS = ['login'] as const;

export class VerifyTurnstileDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  response?: string;

  @IsOptional()
  @IsString()
  cfTurnstileResponse?: string;

  /** When set, a successful check also issues the single-use human-proof cookie. */
  @IsOptional()
  @IsIn(TURNSTILE_PROOF_ACTIONS)
  action?: (typeof TURNSTILE_PROOF_ACTIONS)[number];
}
