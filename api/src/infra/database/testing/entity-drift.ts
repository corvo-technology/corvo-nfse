import type { DataSource } from 'typeorm';

/**
 * What TypeORM would still change to make the database match the entities, ignoring objects
 * that only the hand-written migrations declare: foreign keys, CHECK/UNIQUE constraints,
 * indexes and column defaults (TypeORM reports each of those as something to "drop").
 * Anything else is real drift: a missing table, column or type change.
 * Test helper: an empty list means "migrations and entities agree".
 */
export async function entityDrift(db: DataSource): Promise<string[]> {
  const { upQueries } = await db.driver.createSchemaBuilder().log();
  const migrationOnly =
    /^(DROP INDEX |ALTER TABLE .* (DROP CONSTRAINT |ALTER COLUMN "[^"]+" (DROP|SET) DEFAULT))/;
  return upQueries.map((q) => q.query).filter((q) => !migrationOnly.test(q));
}
