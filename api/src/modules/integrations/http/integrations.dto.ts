import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ServiceDto } from '@/modules/invoice/http/invoice.dto';

export class CreateConnectionDto {
  @IsString() @IsNotEmpty() @MaxLength(40) provider!: string;
  @IsUUID() companyId!: string;
  @IsOptional() @IsIn(['test', 'live']) environment?: 'test' | 'live';
  @IsObject() credentials!: Record<string, string>;
  @IsOptional() @IsDateString() activeFrom?: string;
}

export class UpdateCredentialsDto {
  @IsObject() credentials!: Record<string, string>;
}

export class RuleDto {
  @IsOptional() @IsString() @MaxLength(200) externalProductId?: string | null;
  @ValidateNested() @Type(() => ServiceDto) service!: ServiceDto;
  @IsBoolean() sendEmail!: boolean;
  @IsOptional() @IsBoolean() allowAnonymousCustomer?: boolean;
  @IsOptional() @IsBoolean() cancelOnRefund?: boolean;
}

/** One rule per product and a single default rule (the one without a product). */
@ValidatorConstraint({ name: 'uniqueRuleProducts', async: false })
class UniqueRuleProducts implements ValidatorConstraintInterface {
  validate(rules: unknown): boolean {
    if (!Array.isArray(rules)) return true;
    const keys = (rules as RuleDto[]).map((r) => r.externalProductId ?? '');
    return new Set(keys).size === keys.length;
  }
  defaultMessage(_args: ValidationArguments): string {
    return 'Each externalProductId can have only one rule, and only one rule can omit it';
  }
}

export class PutRulesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  @Validate(UniqueRuleProducts)
  rules!: RuleDto[];
}

export class CompleteCustomerDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsString() @IsNotEmpty() taxId!: string;
  @IsOptional() @IsEmail() email?: string;
}

export class SaleAddressDto {
  @IsOptional() @IsString() @MaxLength(255) street?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) state?: string;
  @IsOptional() @IsString() @Matches(/^\d{8}$/) zip?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string;
  @IsOptional() @IsString() @Matches(/^\d{7}$/) municipalityCode?: string;
}

export class SaleCustomerDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsString() @IsNotEmpty() @MaxLength(30) taxId!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleAddressDto)
  address?: SaleAddressDto;
}

export class SaleServiceDto {
  @IsOptional() @IsString() @Matches(/^\d{6}$/) code?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

/** Everything is optional: with nothing, the sale is simply tried again. */
export class ResolveOperationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleCustomerDto)
  customer?: SaleCustomerDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleServiceDto)
  service?: SaleServiceDto;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}

export class IgnoreOperationDto {
  @IsString() @IsNotEmpty() @MaxLength(200) reason!: string;
}
