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
    const tables: Array<{ relname: string }> = await this.database.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relname=ANY($2::text[])
         AND c.relrowsecurity AND c.relforcerowsecurity
         AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation_policy')`,
      [schema, TENANT_RLS_TABLES],
    );
    if (tables.length !== TENANT_RLS_TABLES.length)
      throw new Error(
        'Tenant RLS policies are missing; run database migrations before starting a runtime',
      );
  }
}
