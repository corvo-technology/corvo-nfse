import { IsString, IsIn, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'API key name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Environment', enum: ['live', 'test'] })
  @IsIn(['live', 'test'])
  environment!: 'live' | 'test';

  @ApiProperty({
    description: 'API key scope',
    enum: [
      'full_access',
      'invoices_issue',
      'invoices_view',
      'invoices_read_write',
    ],
  })
  @IsIn([
    'full_access',
    'invoices_issue',
    'invoices_view',
    'invoices_read_write',
  ])
  scope!:
    'full_access' | 'invoices_issue' | 'invoices_view' | 'invoices_read_write';

  @ApiProperty({ description: 'Expiration date (optional)', required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
