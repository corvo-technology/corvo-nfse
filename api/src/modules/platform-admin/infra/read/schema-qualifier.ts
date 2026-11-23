import type { DataSource } from 'typeorm';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/**
 * Raw SQL has no search_path on pooled connections, so every table is
 * qualified: `t('auth_users')` -> `"corvo"."auth_users"`. The schema comes from
 * the DataSource options (default `corvo`) and is validated as an identifier.
 */
export function schemaQualifier(
  dataSource: DataSource,
): (table: string) => string {
  const options = dataSource.options;
  const schema =
    ('schema' in options && typeof options.schema === 'string'
      ? options.schema
      : undefined) ?? 'corvo';
  if (!IDENTIFIER.test(schema))
    throw new Error('Invalid PostgreSQL schema name');
  return (table) => {
    if (!IDENTIFIER.test(table))
      throw new Error('Invalid PostgreSQL table name');
    return `"${schema}"."${table}"`;
  };
}
