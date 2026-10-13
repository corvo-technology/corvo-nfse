import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class BackfillCompanyFiscalNormalization1791700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const options = runner.connection.options;
    const schema = runner.connection.driver.escape(
      'schema' in options ? (options.schema ?? 'corvo') : 'corvo',
    );
    const companies = `${schema}.nfse_companies`;
    const certificates = `${schema}.nfse_certificates`;

    // 1) Normalize tax_id, skipping rows that would collide on idx_nfse_companies_tenant_tax_id.
    await runner.query(`
      WITH n AS (
        SELECT id, tenant_id, environment,
               UPPER(regexp_replace(tax_id, '[./\\s-]', '', 'g')) AS norm
        FROM ${companies} WHERE deleted_at IS NULL
      ), dups AS (
        SELECT tenant_id, environment, norm FROM n
        GROUP BY tenant_id, environment, norm HAVING count(*) > 1
      )
      UPDATE ${companies} c SET tax_id = n.norm, updated_at = now()
      FROM n
      WHERE n.id = c.id AND c.tax_id <> n.norm
        AND NOT EXISTS (
          SELECT 1 FROM dups d
          WHERE d.tenant_id = n.tenant_id AND d.environment = n.environment AND d.norm = n.norm
        )`);

    const duplicates = (await runner.query(`
      SELECT tenant_id, environment,
             UPPER(regexp_replace(tax_id, '[./\\s-]', '', 'g')) AS norm,
             array_agg(id) AS ids
      FROM ${companies} WHERE deleted_at IS NULL
      GROUP BY tenant_id, environment, UPPER(regexp_replace(tax_id, '[./\\s-]', '', 'g'))
      HAVING count(*) > 1`)) as unknown[] | undefined;
    if (duplicates && duplicates.length > 0)
      console.warn(
        `[backfill] ${duplicates.length} company group(s) share a tax_id after normalization and were skipped:`,
        JSON.stringify(duplicates),
      );

    // 2) Normalize zip only when the digits make a valid 8-digit CEP.
    await runner.query(`
      UPDATE ${companies}
      SET address_zip = regexp_replace(address_zip, '\\D', '', 'g'), updated_at = now()
      WHERE address_zip ~ '\\D'
        AND length(regexp_replace(address_zip, '\\D', '', 'g')) = 8`);

    // 3) Recompute status for every non-blocked, non-deleted company.
    await runner.query(`
      UPDATE ${companies} c
      SET status = CASE
            WHEN NULLIF(btrim(c.municipal_reg), '') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM ${certificates} k
               WHERE k.company_id = c.id AND k.status = 'active'
                 AND k.deleted_at IS NULL AND k.valid_until > now())
            THEN 'ready' ELSE 'pending_setup' END,
          updated_at = now()
      WHERE c.status <> 'blocked' AND c.deleted_at IS NULL
        AND c.status <> CASE
            WHEN NULLIF(btrim(c.municipal_reg), '') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM ${certificates} k
               WHERE k.company_id = c.id AND k.status = 'active'
                 AND k.deleted_at IS NULL AND k.valid_until > now())
            THEN 'ready' ELSE 'pending_setup' END`);
  }

  async down(_runner: QueryRunner): Promise<void> {
    // Data normalization is not reversible and re-running `up` is idempotent.
  }
}
