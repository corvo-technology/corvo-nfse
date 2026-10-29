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
  @IsIn(['test', 'live']) environment!: 'test' | 'live';
  @IsObject() credentials!: Record<string, string>;
  @IsOptional() @IsDateString() activeFrom?: string;
}

export class RuleDto {
  @IsOptional() @IsString() @MaxLength(200) externalProductId?: string | null;
  @ValidateNested() @Type(() => ServiceDto) service!: ServiceDto;
  @IsBoolean() sendEmail!: boolean;
  @IsOptional() @IsBoolean() allowAnonymousCustomer?: boolean;
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
