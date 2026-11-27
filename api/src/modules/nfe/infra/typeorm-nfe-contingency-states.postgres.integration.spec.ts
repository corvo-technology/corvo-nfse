import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { NfeContingencyStateOrmEntity } from './nfe-contingency-state.orm-entity';
import { TypeormNfeContingencyStates } from './typeorm-nfe-contingency-states';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    !parsed.pathname.endsWith('_test')
  )
    throw new Error('NF-e contingency tests require a local _test database');
}
const describePostgres = url ? describe : describe.skip;
const schema = `nfe_svc_test_${randomUUID().replaceAll('-', '')}`;

describePostgres('NfeContingencyStates with real PostgreSQL', () => {
  let db: DataSource;
  let states: TypeormNfeContingencyStates;
  const t1 = new Date('2026-11-26T15:00:00Z');
  const t2 = new Date('2026-11-26T16:00:00Z');
  const state = {
    dhCont: '2026-11-26T12:00:00-03:00',
    xJust: 'SEFAZ de origem indisponivel',
  };

  beforeAll(async () => {
    db = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.runMigrations();
    states = new TypeormNfeContingencyStates(
      db.getRepository(NfeContingencyStateOrmEntity),
    );
  }, 120000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.destroy();
    }
  });

  it('is "none" for a UF nobody entered', async () => {
    expect(await states.get('SP', 2)).toEqual({
      mode: 'none',
      dhCont: null,
      xJust: null,
    });
    expect(await states.listActive()).toEqual([]);
  });

  it('enters once: the second try from the same state does not win', async () => {
    expect(await states.enter('SP', 2, state, t1)).toBe(true);
    expect(await states.enter('sp', 2, state, t2)).toBe(false);
    expect(await states.get('SP', 2)).toEqual({ mode: 'svc', ...state });
    // The other environment and the other UF are untouched.
    expect((await states.get('SP', 1)).mode).toBe('none');
    expect((await states.get('MG', 2)).mode).toBe('none');
  });

  it('lists what is in the SVC, by UF and environment', async () => {
    await states.enter('AM', 1, state, t1);
    expect(await states.listActive()).toEqual([
      { uf: 'AM', tpAmb: 1, enteredAt: t1, dhCont: state.dhCont },
      { uf: 'SP', tpAmb: 2, enteredAt: t1, dhCont: state.dhCont },
    ]);
  });

  it('leaves once, clears the row and can enter again afterwards', async () => {
    expect(await states.exit('SP', 2, t2)).toBe(true);
    expect(await states.exit('SP', 2, t2)).toBe(false);
    expect((await states.get('SP', 2)).mode).toBe('none');
    expect(await states.enter('SP', 2, state, t2)).toBe(true);
  });

  it('refuses a mode or environment outside the constraints', async () => {
    await expect(
      db.query(
        `INSERT INTO "${schema}".nfe_contingency_states (uf, tp_amb, mode) VALUES ('RJ', 3, 'svc')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO "${schema}".nfe_contingency_states (uf, tp_amb, mode) VALUES ('RJ', 2, 'epec')`,
      ),
    ).rejects.toThrow();
  });
});
