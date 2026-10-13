import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsDefined,
  IsEnum,
  IsObject,
  IsISO8601,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TENANT_ADMIN_PERMISSIONS } from '@/modules/auth/domain/permission';
import type { TenantPermission } from '@/modules/auth/domain/permission';

export const TENANT_PERMISSION_VALUES: TenantPermission[] = [
  ...new Set([...TENANT_ADMIN_PERMISSIONS]),
];

class InviteProfessionalCommissionSettingsDto {
  @IsDefined()
  @IsEnum(['percentage'])
  type!: 'percentage';

  @IsDefined()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  value!: number;
}

export class OAuthTokenDto {
  @IsEnum(['authorization_code', 'refresh_token'])
  grant_type!: 'authorization_code' | 'refresh_token';

  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  code_verifier?: string;

  @IsOptional()
  @IsString()
  refresh_token?: string;
}

export class RevokeTokenDto {
  @IsString()
  refresh_token!: string;
}

export class SwitchTenantDto {
  @IsUUID()
  tenantId!: string;
}

export class InviteProfessionalDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(['admin', 'manager', 'professional'])
  role?: 'admin' | 'manager' | 'professional';

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  professionalRole?: string | null;

  @IsOptional()
  @IsUUID()
  professionalRoleCategoryId?: string;

  @IsOptional()
  @IsBoolean()
  isAvailableForBooking?: boolean;

  @IsOptional()
  @IsString()
  specialty?: string | null;

  @IsOptional()
  @IsNumber()
  experienceYears?: number | null;

  @IsOptional()
  @IsString()
  observations?: string | null;

  @IsOptional()
  @Matches(
    /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$|^[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}$/i,
  )
  taxID?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TENANT_PERMISSION_VALUES, { each: true })
  permissions?: TenantPermission[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InviteProfessionalCommissionSettingsDto)
  commissionSettings?: InviteProfessionalCommissionSettingsDto;

  @IsOptional()
  @IsString()
  tenantName?: string;
}
