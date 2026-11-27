import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { NfeEnabledAuthorityOrmEntity } from './nfe-enabled-authority.orm-entity';
import { TypeormNfeEnabledAuthorities } from './typeorm-nfe-enabled-authorities';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  )
    throw new Error('NF-e authority tests require a local _test database');
}
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_auth_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('NfeEnabledAuthorities with real PostgreSQL', () => {
  let db: DataSource;
  let authorities: TypeormNfeEnabledAuthorities;

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    authorities = new TypeormNfeEnabledAuthorities(
      db.getRepository(NfeEnabledAuthorityOrmEntity),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('starts with no UF released', async () => {
    expect(await authorities.isEnabled('SP', 55, 2)).toBe(false);
  });

  it('releases exactly the UF, model and environment that has a row', async () => {
    await db.query(
      `INSERT INTO "${schema}".nfe_enabled_authorities (uf, model, tp_amb, enabled_at, runbook_ref) VALUES ('SP', 55, 2, now(), 'docs/fiscal/nfe-runbook.md')`,
    );
    expect(await authorities.isEnabled('SP', 55, 2)).toBe(true);
    expect(await authorities.isEnabled('sp', 55, 2)).toBe(true);
    expect(await authorities.isEnabled('SP', 55, 1)).toBe(false);
    expect(await authorities.isEnabled('SP', 65, 2)).toBe(false);
    expect(await authorities.isEnabled('MG', 55, 2)).toBe(false);
  });

  it('lists every released UF, model and environment', async () => {
    expect(await authorities.listEnabled()).toEqual([
      { uf: 'SP', model: 55, tpAmb: 2 },
    ]);
  });
});
