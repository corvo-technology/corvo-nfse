import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQuery } from '@/shared/http/pagination';

export class PlatformUsersQuery extends CursorQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.trim() || undefined;
  })
  @IsString()
  @MaxLength(100)
  search?: string;
}
