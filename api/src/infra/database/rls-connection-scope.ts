import type { DataSource } from 'typeorm';
import { getDatabaseScope } from '@/infra/persistence/typeorm/tenant-context.storage';

type Client = { query(sql: string, parameters: unknown[]): Promise<unknown> };
type Obtain = () => Promise<[Client, (error?: unknown) => void]>;
type Driver = {
  obtainMasterConnection: Obtain;
  obtainSlaveConnection?: Obtain;
  corvoRlsInstalled?: boolean;
};

/** Greenflow's acquisition hook, with strict scope and an unconditional reset on reuse. */
export function installRlsConnectionScope(
  dataSource: Pick<DataSource, 'driver'>,
): void {
  const driver = dataSource.driver as unknown as Driver;
  if (driver.corvoRlsInstalled) return;
  if (typeof driver.obtainMasterConnection !== 'function')
    throw new Error('PostgreSQL RLS connection hook is unavailable');
  for (const name of [
    'obtainMasterConnection',
    'obtainSlaveConnection',
  ] as const) {
    const original = driver[name];
    if (!original) continue;
    driver[name] = async () => {
      const [client, release] = await (original.call(
        driver,
      ) as ReturnType<Obtain>);
      try {
        const scope = getDatabaseScope();
        await client.query(
          "SELECT set_config('app.current_tenant_id', $1, false), set_config('app.current_auth_user_id', $2, false), set_config('app.system_context', $3, false)",
          [
            scope?.tenantId ?? '',
            scope?.authUserId ?? '',
            scope?.system ? 'on' : 'off',
          ],
        );
        return [client, release];
      } catch (error) {
        release(error);
        throw error;
      }
    };
  }
  driver.corvoRlsInstalled = true;
}
