import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';
import {
  CUSTOMER_NAME_MAX,
  type SavedCustomer,
} from '../domain/customer-directory';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListCustomersQuery extends CursorQuery {
  @ApiPropertyOptional({
    description:
      'Part of the name, or the first digits of the CPF/CNPJ (punctuation is ignored).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CustomerAddressDto {
  @ApiProperty({ maxLength: 60 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  street!: string;

  @ApiProperty({ maxLength: 60, example: '100' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  number!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  complement?: string | null;

  @ApiProperty({ maxLength: 60 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  district!: string;

  @ApiProperty({ example: '01310100', description: 'CEP, 8 digits.' })
  @Matches(/^\d{8}$/)
  zip!: string;

  @ApiProperty({ example: '3550308', description: 'IBGE city code, 7 digits.' })
  @Matches(/^\d{7}$/)
  cityCode!: string;

  @ApiProperty({ maxLength: 60 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  city!: string;

  @ApiProperty({ example: 'SP' })
  @Matches(/^[A-Z]{2}$/)
  state!: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ maxLength: CUSTOMER_NAME_MAX })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Send null to remove the saved email.',
  })
  @ValidateIf((dto: UpdateCustomerDto) => dto.email !== null)
  @IsOptional()
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({
    type: CustomerAddressDto,
    nullable: true,
    description:
      'Address used to fill the NF-e recipient. Send null to remove.',
  })
  @ValidateIf((dto: UpdateCustomerDto) => dto.address !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerAddressDto)
  address?: CustomerAddressDto | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: [1, 2, 9],
    description:
      '1 contributor, 2 exempt, 9 non-contributor. Send null to remove.',
  })
  @ValidateIf((dto: UpdateCustomerDto) => dto.indIeDest !== null)
  @IsOptional()
  @IsIn([1, 2, 9])
  indIeDest?: 1 | 2 | 9 | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 20,
    description: 'State registration (IE). Send null to remove.',
  })
  @ValidateIf((dto: UpdateCustomerDto) => dto.stateRegistration !== null)
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  stateRegistration?: string | null;
}

export class CustomerResponseDto {
  @ApiProperty({ description: 'CPF or CNPJ, without punctuation.' })
  taxId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
  @ApiProperty({ nullable: true, type: CustomerAddressDto })
  address!: CustomerAddressDto | null;
  @ApiProperty({ nullable: true, enum: [1, 2, 9], type: Number })
  indIeDest!: 1 | 2 | 9 | null;
  @ApiProperty({ nullable: true, type: String })
  stateRegistration!: string | null;
  @ApiProperty() lastUsedAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export function toCustomerResponse(
  customer: SavedCustomer,
): CustomerResponseDto {
  return {
    taxId: customer.taxId,
    name: customer.name,
    email: customer.email,
    address: customer.address,
    indIeDest: customer.indIeDest,
    stateRegistration: customer.stateRegistration,
    lastUsedAt: customer.lastUsedAt.toISOString(),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}
