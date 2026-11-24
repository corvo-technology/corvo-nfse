import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { installRlsConnectionScope } from './rls-connection-scope';
import { TENANT_RLS_TABLES } from './rls-tables';

@Injectable()
export class RlsConnectionScopeService implements OnModuleInit {
  private readonly logger = new Logger(RlsConnectionScopeService.name);
  constructor(private readonly database: DataSource) {}
  async onModuleInit(): Promise<void> {
    installRlsConnectionScope(this.database);
    const [role]: Array<{ rolsuper: boolean; rolbypassrls: boolean }> =
      await this.database.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
    if (role.rolsuper || role.rolbypassrls) {
      if (process.env.NODE_ENV === 'production')
        throw new Error(
          'Runtime database role must be NOSUPERUSER NOBYPASSRLS; use a separate migration role',
        );
      this.logger.warn(
        'Database role bypasses RLS; use a restricted runtime role to exercise database isolation',
      );
    }
    const schema =
      (this.database.options as { schema?: string }).schema ?? 'corvo';
    // Migrations run in a separate deploy step; on a fresh deploy the runtime
    // can boot before they finish. Wait (without reporting each try) and only
    // fail after the timeout, so we never run without RLS policies.
    const timeoutMs = readMs('RLS_MIGRATIONS_WAIT_TIMEOUT_MS', 180_000);
    const intervalMs = Math.max(
      readMs('RLS_MIGRATIONS_WAIT_INTERVAL_MS', 3_000),
      1,
    );
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const missing = await this.missingTables(schema);
      if (missing.length === 0) return;
      if (Date.now() + intervalMs > deadline)
        throw new Error(
          `Tenant RLS policies are missing (${missing.join(', ')}); run database migrations before starting a runtime`,
        );
      this.logger.warn(
        `Waiting for migrations (missing: ${missing.join(', ')}); retrying in ${intervalMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private async missingTables(schema: string): Promise<string[]> {
    const tables: Array<{ relname: string }> = await this.database.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relname=ANY($2::text[])
         AND c.relrowsecurity AND c.relforcerowsecurity
         AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation_policy')`,
      [schema, TENANT_RLS_TABLES],
    );
    const ok = new Set(tables.map((table) => table.relname));
    return TENANT_RLS_TABLES.filter((name) => !ok.has(name));
  }
}

function readMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) &&
    value >= 0 &&
    process.env[name] !== undefined &&
    process.env[name] !== ''
    ? value
    : fallback;
}
