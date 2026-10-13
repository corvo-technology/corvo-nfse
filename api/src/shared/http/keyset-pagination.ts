import { createHash } from 'node:crypto';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  CursorPage,
  CursorQuery,
  decodeCursor,
  encodeCursor,
  invalidCursor,
  normalizeLimit,
} from './pagination';

type KeysetCursor = {
  v: 1;
  scope: string;
  sort: string | number;
  id: string;
  context?: { since: string };
};
export function cursorScope(scope: unknown): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}
export function readKeysetCursor(
  cursor: string | undefined,
  scope: unknown,
): KeysetCursor | null {
  const value = decodeCursor<Partial<KeysetCursor>>(cursor);
  if (!value) return null;
  if (
    value.v !== 1 ||
    value.scope !== cursorScope(scope) ||
    typeof value.id !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      value.id,
    ) ||
    (typeof value.sort !== 'string' && typeof value.sort !== 'number') ||
    (value.context !== undefined &&
      (!value.context ||
        typeof value.context.since !== 'string' ||
        !Number.isFinite(Date.parse(value.context.since))))
  )
    return invalidCursor();
  return value as KeysetCursor;
}
/** Queries limit + 1 rows and keeps PostgreSQL microseconds in the cursor. */
export async function queryCursorPage<E extends ObjectLiteral, T>(
  query: SelectQueryBuilder<E>,
  options: CursorQuery,
  scope: unknown,
  present: (entity: E) => T,
  config: {
    column?: string;
    direction?: 'ASC' | 'DESC';
    numeric?: boolean;
    context?: { since: string };
  } = {},
): Promise<CursorPage<T>> {
  const limit = normalizeLimit(options.limit);
  const cursor = readKeysetCursor(options.cursor, scope);
  const column = `${query.alias}.${config.column ?? 'createdAt'}`;
  const id = `${query.alias}.id`;
  const direction = config.direction ?? 'DESC';
  if (cursor) {
    if (
      config.numeric
        ? typeof cursor.sort !== 'number' || !Number.isFinite(cursor.sort)
        : typeof cursor.sort !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.sort) ||
          !Number.isFinite(Date.parse(cursor.sort))
    )
      return invalidCursor();
    const operator = direction === 'DESC' ? '<' : '>';
    query.andWhere(
      `(${column} ${operator} :cursorSort OR (${column} = :cursorSort AND ${id} ${operator} :cursorId))`,
      { cursorSort: cursor.sort, cursorId: cursor.id },
    );
  }
  const sortSelection = config.numeric
    ? column
    : `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const { entities, raw } = await query
    .addSelect(sortSelection, 'pagination_sort')
    .orderBy(column, direction)
    .addOrderBy(id, direction)
    .take(limit + 1)
    .getRawAndEntities<{ pagination_sort: string }>();
  const hasMore = entities.length > limit;
  const pageEntities = entities.slice(0, limit);
  const last = pageEntities[pageEntities.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          scope: cursorScope(scope),
          sort: config.numeric
            ? Number(raw[limit - 1].pagination_sort)
            : raw[limit - 1].pagination_sort,
          id: last.id as string,
          ...(config.context ? { context: config.context } : {}),
        })
      : null;
  return new CursorPage(pageEntities.map(present), {
    limit,
    hasMore,
    nextCursor,
  });
}
