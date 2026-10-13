import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteMemberDto {
  @ApiProperty({ example: 'colleague@company.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Maria Santos' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ['admin', 'developer', 'billing'] })
  @IsIn(['admin', 'developer', 'billing'])
  role!: 'admin' | 'developer' | 'billing';
}
