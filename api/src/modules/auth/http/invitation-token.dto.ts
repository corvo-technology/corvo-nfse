import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InvitationTokenDto {
  @ApiProperty({ description: 'Single-use token from the invitation e-mail' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}
