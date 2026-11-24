import type { DataSource } from 'typeorm';
import {
  getDatabaseScope,
  type DatabaseScope,
} from '@/infra/persistence/typeorm/tenant-context.storage';

/**
 * Tenant / system scope that is correct behind a PgBouncer in TRANSACTION pooling
 * mode (the managed Postgres on Guara Cloud).
 *
 * In that mode two statements of the same client may run on different server
 * connections, so session settings (`set_config(..., false)`) leak between
 * requests. The scope is therefore always transaction-local (`set_config(..., true)`)
 * and sent on the same transaction as the statements it protects:
 *
 *  - explicit transaction: the first statement after BEGIN/START TRANSACTION
 *    (after `SET TRANSACTION ...`, which Postgres requires to come first) is
 *    `set_config(..., true)`, taken from the AsyncLocalStorage scope that was
 *    current when the transaction started;
 *  - autocommit statement: `BEGIN; set_config(..., true)`, the statement, `COMMIT`,
 *    on the same checked-out client, so it never depends on session state.
 *
 * Nothing is ever written at session level, so a worker's `system_context = on`
 * cannot survive on a server connection after its transaction ends.
 */

type QueryConfig = { text: string; values?: unknown[] } & Record<
  string,
  unknown
>;
type Submittable = { submit: (...args: unknown[]) => void };
type Client = {
  query(...args: unknown[]): unknown;
} & Record<string, unknown>;
type Release = (error?: unknown) => void;
type Obtain = () => Promise<[Client, Release]>;
type Driver = {
  obtainMasterConnection: Obtain;
  obtainSlaveConnection?: Obtain;
  corvoRlsInstalled?: boolean;
};

const SAFE_VALUE = /^[A-Za-z0-9_-]*$/;
const BEGIN = /^\s*(?:BEGIN|START\s+TRANSACTION)\b/i;
const END =
  /^\s*(?:COMMIT|END|ABORT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?\s*;?\s*$/i;
const SET_TRANSACTION = /^\s*SET\s+TRANSACTION\b/i;

/** `SELECT set_config(..., true)` for the scope. Values are validated, so they can be inlined. */
export function scopeSettingsSql(scope: DatabaseScope | undefined): string {
  const values = [
    scope?.tenantId ?? '',
    scope?.authUserId ?? '',
    scope?.system ? 'on' : 'off',
  ];
  for (const value of values)
    if (!SAFE_VALUE.test(value))
      throw new Error('Invalid database scope value');
  return `SELECT set_config('app.current_tenant_id', '${values[0]}', true), set_config('app.current_auth_user_id', '${values[1]}', true), set_config('app.system_context', '${values[2]}', true)`;
}

function isSubmittable(value: unknown): value is Submittable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Submittable).submit === 'function'
  );
}

/** Wraps one checked-out pg client for the duration of the checkout. */
export function scopeClient(raw: Client, release: Release): [Client, Release] {
  let inTransaction = false;
  let pendingSettings: string | undefined;
  const rawQuery = (config: unknown): Promise<unknown> =>
    raw.query(config) as Promise<unknown>;

  async function inScopedTransaction(config: QueryConfig): Promise<unknown> {
    const settings = pendingSettings;
    if (!settings) return rawQuery(config);
    pendingSettings = undefined;
    // Queued back to back on the same client: the settings always precede the statement.
    const [applied, result] = await Promise.allSettled([
      rawQuery(settings),
      rawQuery(config),
    ]);
    if (applied.status === 'rejected') throw applied.reason;
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }

  async function autocommit(config: QueryConfig): Promise<unknown> {
    const settings = scopeSettingsSql(getDatabaseScope());
    try {
      await rawQuery(`BEGIN; ${settings}`);
    } catch (error) {
      await rawQuery('ROLLBACK').catch(() => undefined);
      throw error;
    }
    // COMMIT right behind the statement; on failure it simply rolls the aborted transaction back.
    const [result, commit] = await Promise.allSettled([
      rawQuery(config),
      rawQuery('COMMIT'),
    ]);
    if (result.status === 'rejected') throw result.reason;
    if (commit.status === 'rejected') throw commit.reason;
    return result.value;
  }

  async function execute(first: unknown, values: unknown): Promise<unknown> {
    if (isSubmittable(first)) {
      // Streams/cursors: only inside an explicit transaction, where the scope is already set.
      if (!inTransaction)
        throw new Error('Streaming queries require an explicit transaction');
      if (pendingSettings) {
        const settings = pendingSettings;
        pendingSettings = undefined;
        void rawQuery(settings);
      }
      return rawQuery(first);
    }
    const config: QueryConfig =
      typeof first === 'string'
        ? { text: first, values: values as unknown[] | undefined }
        : (first as QueryConfig);
    const text = config.text;
    if (BEGIN.test(text)) {
      const result = await rawQuery(config);
      inTransaction = true;
      pendingSettings = scopeSettingsSql(getDatabaseScope());
      return result;
    }
    if (END.test(text)) {
      try {
        return await rawQuery(config);
      } finally {
        inTransaction = false;
        pendingSettings = undefined;
      }
    }
    if (inTransaction) {
      if (SET_TRANSACTION.test(text)) return rawQuery(config);
      return inScopedTransaction(config);
    }
    return autocommit(config);
  }

  const query = (...args: unknown[]): unknown => {
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (error: unknown, result?: unknown) => void)
        : undefined;
    const promise = execute(args[0], args[1]);
    if (!callback) return promise;
    promise.then(
      (result) => callback(null, result),
      (error) => callback(error),
    );
    return undefined;
  };

  const scoped = new Proxy(raw, {
    get(target, property): unknown {
      if (property === 'query') return query;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const guardedRelease: Release = (error) => {
    // A connection must never go back to the pool inside a transaction.
    const failure =
      error ??
      (inTransaction
        ? new Error('Connection released inside an open transaction')
        : undefined);
    inTransaction = false;
    pendingSettings = undefined;
    release(failure);
  };
  return [scoped, guardedRelease];
}

/** Installs the transaction-local scope on every connection the driver hands out. */
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
      const [client, release] = (await original.call(driver)) as [
        Client,
        Release,
      ];
      return scopeClient(client, release);
    };
  }
  driver.corvoRlsInstalled = true;
}
