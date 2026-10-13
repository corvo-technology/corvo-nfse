import { IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadCertificateDto {
  @IsString()
  @MaxLength(100)
  password!: string;
}

export class CertificateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  serialNumber!: string;

  @ApiProperty()
  issuer!: string;

  @ApiProperty()
  subject!: string;

  @ApiProperty()
  fingerprint!: string;

  @ApiPropertyOptional()
  validFrom?: Date;

  @ApiPropertyOptional()
  validUntil?: Date;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  createdAt?: Date;
}
