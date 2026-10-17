import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const schema = process.env.DB_SCHEMA ?? 'corvo';
const runtimeRole = 'corvo_backend_runtime';
const password = process.env.POSTGRES_RUNTIME_PASSWORD;
if (!/^[a-z_][a-z0-9_]*$/i.test(schema) || !password) {
  throw new Error('Invalid DB_SCHEMA or POSTGRES_RUNTIME_PASSWORD.');
}
const identifier = (name) => `"${name.replaceAll('"', '""')}"`;
const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  // Serialize repeated setup jobs without changing API/worker startup.
  await client.query("SELECT pg_advisory_lock(hashtext('corvo-deploy-migrations'))");
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/infra/database/data-source.js',
  ], { maxBuffer: 10 * 1024 * 1024 });
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  await client.query('BEGIN');
  const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [runtimeRole]);
  if (role.rowCount === 0) await client.query(`CREATE ROLE ${identifier(runtimeRole)}`);
  const alteration = await client.query(
    "SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', $1::text, $2::text) AS statement",
    [runtimeRole, password],
  );
  await client.query(alteration.rows[0].statement);
  const target = identifier(schema);
  const runtime = identifier(runtimeRole);
  await client.query(`GRANT USAGE ON SCHEMA ${target} TO ${runtime}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${target} TO ${runtime}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${target} TO ${runtime}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${target} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${target} GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}`);
  await client.query(`REVOKE ALL ON TABLE ${target}.migrations FROM ${runtime}`);
  await client.query('COMMIT');
  console.log('Migrations applied and runtime role configured without RLS bypass.');
} finally {
  // Closing the session also releases the advisory lock and rolls back errors.
  await client.end();
}
