import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PlatformCreditGrantDto {
  @IsInt()
  @Min(1)
  @Max(500)
  amount!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  notifyUser: boolean = false;
}
