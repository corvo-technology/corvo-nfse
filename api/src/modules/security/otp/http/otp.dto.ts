import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  OTP_PURPOSES,
  type OtpChannel,
  type OtpPurpose,
} from '../domain/otp.types';

const SENSITIVE_CONTEXT_PURPOSES: readonly OtpPurpose[] = [
  'payment_authorization',
  'consent_confirmation',
];

export class RequestOtpDto {
  @IsEnum(['email', 'whatsapp'])
  channel!: OtpChannel;

  @IsEnum(OTP_PURPOSES)
  purpose!: OtpPurpose;

  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  target!: string;

  @ValidateIf(
    (dto: RequestOtpDto) =>
      SENSITIVE_CONTEXT_PURPOSES.includes(dto.purpose) ||
      dto.contextId !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  contextId?: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
