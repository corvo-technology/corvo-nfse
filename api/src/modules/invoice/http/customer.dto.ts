import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
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
}

export class CustomerResponseDto {
  @ApiProperty({ description: 'CPF or CNPJ, without punctuation.' })
  taxId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) email!: string | null;
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
    lastUsedAt: customer.lastUsedAt.toISOString(),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}
