import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;
export const MAX_PAGE_SIZE = MAX_LIMIT;
export type CursorPayload = Record<string, unknown>;
export class CursorQuery {
  @ApiPropertyOptional({
    default: DEFAULT_LIMIT,
    minimum: 1,
    maximum: MAX_LIMIT,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeLimit(value))
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  cursor?: string;
}
export class CursorPage<T> {
  constructor(
    public data: T[],
    public pagination: {
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
    },
  ) {}
  map<U>(present: (item: T) => U): CursorPage<U> {
    return new CursorPage(this.data.map(present), this.pagination);
  }
}
export type CursorPaginationResult<T> = CursorPage<T>;
export function invalidCursor(): never {
  throw new BadRequestException({
    code: 'ERROR_INVALID_CURSOR',
    message: 'Invalid or incompatible pagination cursor',
  });
}
export function normalizeLimit(
  value: unknown,
  fallback = DEFAULT_LIMIT,
): number {
  if (value === undefined) return fallback;
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !/^\d+$/.test(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > MAX_LIMIT
  ) {
    throw new BadRequestException({
      code: 'ERROR_INVALID_LIMIT',
      message: 'limit must be an integer between 1 and 1000',
    });
  }
  return Number(value);
}
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
export function decodeCursor<T = CursorPayload>(cursor?: string): T | null {
  if (cursor === undefined) return null;
  if (
    typeof cursor !== 'string' ||
    cursor.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  )
    return invalidCursor();
  try {
    const raw = Buffer.from(cursor, 'base64url');
    if (raw.toString('base64url') !== cursor) return invalidCursor();
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return invalidCursor();
    return parsed as T;
  } catch {
    return invalidCursor();
  }
}
export function paginateItems<T>(
  items: T[],
  limit: number,
  cursorOf: (item: T) => CursorPayload,
): CursorPage<T> {
  const size = normalizeLimit(limit);
  const data = items.slice(0, size);
  const hasMore = items.length > size;
  return new CursorPage(data, {
    limit: size,
    hasMore,
    nextCursor:
      hasMore && data.length
        ? encodeCursor(cursorOf(data[data.length - 1]))
        : null,
  });
}
