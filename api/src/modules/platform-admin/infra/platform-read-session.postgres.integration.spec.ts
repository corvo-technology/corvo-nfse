import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { PlatformReadSession } from './platform-read-session';

const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Platform read integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `pra_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;
const tenantA = randomUUID();
const tenantB = randomUUID();

describePostgres(
  'PlatformReadSession with a restricted PostgreSQL role',
  () => {
    let admin: DataSource;
    let runtime: DataSource;
    let stray: DataSource;
    let session: PlatformReadSession;
    const table = (name: string) => `"${schema}"."${name}"`;

    beforeAll(async () => {
      admin = new DataSource(
        createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
      );
      await admin.initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.runMigrations();
      await admin.query(
        `INSERT INTO ${table('tenants')} (id) VALUES ($1),($2)`,
        [tenantA, tenantB],
      );
      for (const tenant of [tenantA, tenantB])
        await admin.query(
          `INSERT INTO ${table('tenant_settings')} (id,tenant_id,timezone) VALUES ($1,$2,'America/Sao_Paulo')`,
          [randomUUID(), tenant],
        );
      const password = randomBytes(24).toString('hex');
      await admin.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
      );
      const [owner]: Array<{ role: string }> = await admin.query(
        'SELECT current_user AS role',
      );
      execFileSync(
        'psql',
        [
          url!,
          '-w',
          '-v',
          `runtime_role=${role}`,
          '-v',
          `migration_role=${owner.role}`,
          '-v',
          `app_schema=${schema}`,
          '-f',
          resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
        ],
        { stdio: 'pipe' },
      );
      const runtimeUrl = new URL(url!);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      const options = createTypeOrmOptions({
        url: runtimeUrl.toString(),
        schema,
        ssl: false,
        logging: false,
      });
      runtime = new DataSource({
        ...options,
        extra: { ...options.extra, max: 1 },
      });
      await runtime.initialize();
      installRlsConnectionScope(runtime);
      await new RlsConnectionScopeService(runtime).onModuleInit();
      // A second pool plays the "other repository" that would take its own connection.
      stray = new DataSource({
        ...options,
        extra: { ...options.extra, max: 1 },
      });
      await stray.initialize();
      installRlsConnectionScope(stray);
      session = new PlatformReadSession(runtime);
    }, 180000);

    afterAll(async () => {
      if (stray?.isInitialized) await stray.destroy();
      if (runtime?.isInitialized) await runtime.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        await admin.destroy();
      }
    });

    it('lê linhas de dois tenants (RLS aberto só para leitura)', async () => {
      const rows = await session.run((q) =>
        q<{ tenant_id: string }>(
          `SELECT tenant_id FROM ${table('tenant_settings')} ORDER BY tenant_id`,
        ),
      );
      expect(rows.map((r) => r.tenant_id).sort()).toEqual(
        [tenantA, tenantB].sort(),
      );
    });

    it('lê os dois tenants mesmo chamado dentro do escopo de um tenant', async () => {
      const rows = await runWithTenant(tenantA, () =>
        session.run((q) =>
          q(`SELECT tenant_id FROM ${table('tenant_settings')}`),
        ),
      );
      expect(rows).toHaveLength(2);
    });

    it('um INSERT por este caminho falha com "read-only transaction", com app.system_context=on', async () => {
      await expect(
        session.run(async (q) => {
          const [flag] = await q<{ v: string }>(
            "SELECT current_setting('app.system_context', true) AS v",
          );
          expect(flag.v).toBe('on');
          await q(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [
            randomUUID(),
          ]);
        }),
      ).rejects.toThrow(/read-only transaction/);
    });

    it('um UPDATE por este caminho também falha', async () => {
      await expect(
        session.run((q) =>
          q(`UPDATE ${table('tenant_settings')} SET timezone='UTC'`),
        ),
      ).rejects.toThrow(/read-only transaction/);
    });

    it('acesso fora de q dentro do trabalho não escreve em nenhum tenant (RLS nega)', async () => {
      const outcome = await session.run(async (q) => {
        await q('SELECT 1');
        try {
          const res = await stray.query(
            `UPDATE ${table('tenant_settings')} SET timezone='UTC'`,
          );
          return { res };
        } catch (error) {
          return { error };
        }
      });
      const [rows]: Array<{ n: number }> = await admin.query(
        `SELECT count(*)::int AS n FROM ${table('tenant_settings')} WHERE timezone='UTC'`,
      );
      expect(rows.n).toBe(0);
      expect(outcome).toBeDefined();
      await expect(
        session.run(async () => {
          await stray.query(
            `INSERT INTO ${table('tenants')} (id) VALUES ($1)`,
            [randomUUID()],
          );
        }),
      ).rejects.toThrow();
    });

    it('após o uso a conexão volta sem system_context', async () => {
      await session.run((q) => q('SELECT 1'));
      const [row]: Array<{ v: string }> = await runtime.query(
        "SELECT current_setting('app.system_context', true) AS v",
      );
      expect(row.v).not.toBe('on');
    });
  },
);
