import type { DataSource } from 'typeorm';

/** Rows deleted per statement. Small on purpose: never one giant DELETE. */
export const RETENTION_BATCH_SIZE = 1000;
/** Most batches one rule runs per night (so at most 200 000 rows); the rest waits for the next night. */
export const RETENTION_MAX_BATCHES = 200;

/**
 * One purge rule: the rows of `table` that match `where` are old enough to go.
 * `where` is trusted SQL written in code (never user input); `params` fill its $1, $2...
 * The table must have an `id` column.
 */
export interface RetentionRule {
  table: string;
  rule: string;
  where: string;
  params: unknown[];
}

export interface RetentionOutcome {
  table: string;
  rule: string;
  dryRun: boolean;
  /** Rows that matched when the rule started. */
  matched: number;
  deleted: number;
  durationMs: number;
}

/**
 * Runs one rule. With `enabled` false (the default of DATA_RETENTION_ENABLED) it only counts what it
 * would delete. With it true it deletes in batches, with a cap per run. The caller wraps this in
 * `runAsSystem('data_retention', ...)` so row level security lets it see every tenant.
 */
export async function runRetentionRule(
  dataSource: DataSource,
  rule: RetentionRule,
  enabled: boolean,
  log: (outcome: RetentionOutcome) => void,
  limits = {
    batchSize: RETENTION_BATCH_SIZE,
    maxBatches: RETENTION_MAX_BATCHES,
  },
): Promise<RetentionOutcome> {
  const startedAt = Date.now();
  const counted = await dataSource.query<{ n: string }[]>(
    `SELECT count(*) AS n FROM ${rule.table} WHERE ${rule.where}`,
    rule.params,
  );
  const matched = Number(counted[0]?.n ?? 0);
  let deleted = 0;
  if (enabled && matched > 0) {
    const limitParam = `$${rule.params.length + 1}`;
    for (let batch = 0; batch < limits.maxBatches; batch++) {
      const raw: unknown = await dataSource.query(
        `DELETE FROM ${rule.table} WHERE id IN (
           SELECT id FROM ${rule.table} WHERE ${rule.where}
           LIMIT ${limitParam} FOR UPDATE SKIP LOCKED
         ) RETURNING id`,
        [...rule.params, limits.batchSize],
      );
      // The driver answers DELETE ... RETURNING with [rows, affected] (UPDATE) or rows; count either.
      const list = raw as unknown[];
      const rows = Array.isArray(list[0]) ? (list[0] as unknown[]) : list;
      deleted += rows.length;
      if (rows.length < limits.batchSize) break;
    }
  }
  const outcome: RetentionOutcome = {
    table: rule.table,
    rule: rule.rule,
    dryRun: !enabled,
    matched,
    deleted,
    durationMs: Date.now() - startedAt,
  };
  log(outcome);
  return outcome;
}
