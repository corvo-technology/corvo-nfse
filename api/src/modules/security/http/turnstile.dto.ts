import { IsOptional, IsString } from 'class-validator';

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
}
