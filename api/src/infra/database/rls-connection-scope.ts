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
 *    current when the transaction started (and re-applied after
 *    `COMMIT/ROLLBACK AND CHAIN`, which starts a new transaction);
 *  - autocommit statement without parameters: ONE simple-protocol message,
 *    `BEGIN; set_config(..., true); <statement>; COMMIT`, so it costs a single
 *    round trip;
 *  - autocommit statement with parameters (or several statements): `BEGIN;
 *    set_config(...)`, the statement and `COMMIT`, three messages. node-postgres
 *    does not pipeline, so this costs three round trips; the statement is never
 *    sent if the scope could not be applied.
 *
 * Multi-message jobs of one client never interleave: a per-client gate holds every
 * later statement until the running job (including its cleanup) is over, so
 * concurrent callers sharing one QueryRunner each get their own scope.
 *
 * Nothing is ever written at session level, so a worker's `system_context = on`
 * cannot survive on a server connection after its transaction ends.
 *
 * Not supported (fails closed): streaming outside an explicit transaction,
 * `PREPARE TRANSACTION`, `COMMIT/ROLLBACK PREPARED` and malformed
 * `BEGIN`/`COMMIT`/`ROLLBACK` statements. Transaction control hidden inside a
 * multi-statement text (`SELECT 1; COMMIT`) is not parsed; do not send it.
 */

type QueryConfig = { text: string; values?: unknown[] } & Record<
  string,
  unknown
>;
type Submittable = { submit: (...args: unknown[]) => void };
type Client = {
  query(...args: unknown[]): unknown;
} & Record<string | symbol, unknown>;
type Release = (error?: unknown) => void;
type Obtain = () => Promise<[Client, Release]>;
type Driver = {
  obtainMasterConnection: Obtain;
  obtainSlaveConnection?: Obtain;
  corvoRlsInstalled?: boolean;
};

const SAFE_VALUE = /^[A-Za-z0-9_-]*$/;
/** Marks a client that is already wrapped, so it is never wrapped twice. */
const SCOPED = Symbol.for('corvo.rls.scopedClient');
const noop = (): undefined => undefined;
const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

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

/** Drops leading whitespace, `-- line` and (nested) block comments. */
export function stripLeadingNoise(text: string): string {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    if (trimmed.startsWith('--')) {
      const newline = trimmed.indexOf('\n');
      rest = newline === -1 ? '' : trimmed.slice(newline + 1);
    } else if (trimmed.startsWith('/*')) {
      let depth = 0;
      let index = 0;
      for (; index < trimmed.length; index++) {
        if (trimmed.startsWith('/*', index)) {
          depth++;
          index++;
        } else if (trimmed.startsWith('*/', index)) {
          depth--;
          index++;
          if (depth === 0) break;
        }
      }
      rest = trimmed.slice(index + 1);
    } else {
      return trimmed;
    }
  }
}

export type TransactionControl =
  | { kind: 'begin' }
  | { kind: 'end'; chain: boolean }
  | { kind: 'set-transaction' };

const BEGIN_REST = /^[A-Za-z\s,]*;?\s*$/;
const END_REST =
  /^(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(NO\s+)?CHAIN)?\s*;?\s*$/i;

/**
 * Classifies a statement that changes the transaction boundary. Returns
 * `undefined` for everything else (including savepoints). Throws for control
 * statements it cannot track safely, so they fail closed.
 */
export function classifyTransactionStatement(
  text: string,
): TransactionControl | undefined {
  const statement = stripLeadingNoise(text);
  const word = /^([A-Za-z]+)\b/.exec(statement);
  if (!word) return undefined;
  // Trailing comments after the keywords are harmless; drop them before matching.
  const rest = statement
    .slice(word[0].length)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  switch (word[1].toUpperCase()) {
    case 'BEGIN':
      return beginOrThrow(rest);
    case 'START':
      return /^\s+TRANSACTION\b/i.test(rest)
        ? beginOrThrow(rest.replace(/^\s+TRANSACTION/i, ''))
        : undefined;
    case 'PREPARE':
      if (/^\s+TRANSACTION\b/i.test(rest))
        throw new Error('PREPARE TRANSACTION is not supported');
      return undefined;
    case 'SET':
      return /^\s+TRANSACTION\b/i.test(rest)
        ? { kind: 'set-transaction' }
        : undefined;
    case 'COMMIT':
    case 'END':
    case 'ROLLBACK':
    case 'ABORT': {
      if (/^\s+PREPARED\b/i.test(rest))
        throw new Error('COMMIT/ROLLBACK PREPARED is not supported');
      // ROLLBACK [WORK|TRANSACTION] TO [SAVEPOINT] x keeps the transaction open.
      if (/^(?:\s+(?:WORK|TRANSACTION))?\s+TO\b/i.test(rest)) return undefined;
      const match = END_REST.exec(rest);
      if (!match) throw new Error('Unsupported transaction control statement');
      const chain = /\bAND\s+CHAIN\b/i.test(rest);
      return { kind: 'end', chain };
    }
    default:
      return undefined;
  }
}

function beginOrThrow(rest: string): TransactionControl {
  if (!BEGIN_REST.test(rest))
    throw new Error('Unsupported transaction control statement');
  return { kind: 'begin' };
}

function isSubmittable(value: unknown): value is Submittable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Submittable).submit === 'function'
  );
}

function hasParameters(config: QueryConfig): boolean {
  return Array.isArray(config.values) && config.values.length > 0;
}

/** Plain text, no parameters, one statement: can ride in a multi-statement simple query. */
function singleStatement(config: QueryConfig): string | undefined {
  if (hasParameters(config) || typeof config.text !== 'string') return;
  for (const [key, value] of Object.entries(config))
    if (key !== 'text' && key !== 'values' && value !== undefined) return;
  const statement = config.text.replace(/[\s;]+$/, '');
  if (!statement.trim() || statement.includes(';')) return;
  return statement;
}

/** Wraps one checked-out pg client for the duration of the checkout. */
export function scopeClient(raw: Client, release: Release): [Client, Release] {
  if (raw[SCOPED]) return [raw, release];

  let inTransaction = false;
  let pendingSettings: string | undefined;
  let transactionSettings: string | undefined;
  // Set while an autocommit job runs; everything else waits for it.
  let gate: Promise<void> | undefined;

  const send = (config: unknown): Promise<unknown> => {
    try {
      return Promise.resolve(raw.query(config));
    } catch (error) {
      return Promise.reject(asError(error));
    }
  };

  /**
   * Runs a multi-message job alone on this client: every later statement waits
   * until it (and its cleanup) is over. The job starts synchronously.
   */
  function exclusive(job: () => Promise<unknown>): Promise<unknown> {
    const run = job();
    const tail = run.then(noop, noop);
    gate = tail;
    void tail.then(() => {
      if (gate === tail) gate = undefined;
    });
    return run;
  }

  function inScopedTransaction(config: QueryConfig): Promise<unknown> {
    const settings = pendingSettings;
    if (!settings) return send(config);
    pendingSettings = undefined;
    // If the settings fail the transaction is aborted and the statement is never sent.
    return exclusive(async () => {
      await send(settings);
      return send(config);
    });
  }

  /** Streams/cursors run synchronously, and only inside an explicit transaction. */
  function submit(submittable: Submittable): unknown {
    if (!inTransaction)
      throw new Error(
        'Streaming queries (QueryRunner.stream, cursors) require an explicit transaction',
      );
    if (pendingSettings) {
      const settings = pendingSettings;
      pendingSettings = undefined;
      // Queued before the stream. If it fails the transaction is aborted and the
      // stream fails with it, so the error is reported there, not as a rejection here.
      send(settings).catch(noop);
    }
    return raw.query(submittable);
  }

  function begin(config: QueryConfig): Promise<unknown> {
    if (inTransaction) return send(config); // PostgreSQL only warns
    const settings = scopeSettingsSql(getDatabaseScope());
    inTransaction = true;
    transactionSettings = settings;
    pendingSettings = settings;
    return send(config).catch((error: unknown) => {
      inTransaction = false;
      transactionSettings = pendingSettings = undefined;
      throw error;
    });
  }

  function end(config: QueryConfig, chain: boolean): Promise<unknown> {
    if (chain && inTransaction) {
      // A new transaction starts right away and has no settings yet.
      pendingSettings = transactionSettings;
      return send(config);
    }
    inTransaction = false;
    transactionSettings = pendingSettings = undefined;
    return send(config);
  }

  async function combined(
    statement: string,
    settings: string,
  ): Promise<unknown> {
    // The newline keeps a trailing `-- comment` from swallowing the COMMIT.
    try {
      const results = await send(`BEGIN;${settings};\n${statement}\n;COMMIT`);
      if (!Array.isArray(results) || results.length !== 4)
        throw new Error('Unexpected result of a scoped statement');
      return results[2];
    } catch (error) {
      // An error inside a simple-protocol batch leaves the transaction open and aborted.
      await send('ROLLBACK').catch(noop);
      throw error;
    }
  }

  function sequential(config: QueryConfig, settings: string): Promise<unknown> {
    // One message at a time (node-postgres does not pipeline anyway). If the scope
    // cannot be applied the statement is never sent.
    return exclusive(async () => {
      try {
        await send(`BEGIN;${settings}`);
        const result = await send(config);
        await send('COMMIT');
        return result;
      } catch (error) {
        // A failed statement leaves the transaction open and aborted.
        await send('ROLLBACK').catch(noop);
        throw error;
      }
    });
  }

  function autocommit(config: QueryConfig): Promise<unknown> {
    const settings = scopeSettingsSql(getDatabaseScope());
    const statement = singleStatement(config);
    return statement
      ? exclusive(() => combined(statement, settings))
      : sequential(config, settings);
  }

  function execute(config: QueryConfig): Promise<unknown> {
    if (gate) return gate.then(() => execute(config));
    const text = typeof config.text === 'string' ? config.text : '';
    const control = classifyTransactionStatement(text);
    if (control?.kind === 'begin') return begin(config);
    if (control?.kind === 'end') return end(config, control.chain);
    if (inTransaction) {
      if (control?.kind === 'set-transaction') return send(config);
      return inScopedTransaction(config);
    }
    return autocommit(config);
  }

  const query = (...args: unknown[]): unknown => {
    if (isSubmittable(args[0])) return submit(args[0]);
    const callback =
      typeof args[args.length - 1] === 'function'
        ? (args.pop() as (error: unknown, result?: unknown) => void)
        : undefined;
    const config: QueryConfig =
      typeof args[0] === 'string'
        ? { text: args[0], values: args[1] as unknown[] | undefined }
        : (args[0] as QueryConfig);
    let promise: Promise<unknown>;
    try {
      promise = execute(config);
    } catch (error) {
      promise = Promise.reject(asError(error));
    }
    if (!callback) return promise;
    promise.then(
      (result) => callback(null, result),
      (error) => callback(error),
    );
    return undefined;
  };

  const scoped = new Proxy(raw, {
    get(target, property): unknown {
      if (property === SCOPED) return true;
      if (property === 'query') return query;
      const value: unknown = Reflect.get(target, property, target);
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
    transactionSettings = pendingSettings = undefined;
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
      // Without replicas TypeORM's obtainSlaveConnection returns the (already
      // wrapped) master connection: scopeClient leaves wrapped clients alone.
      return scopeClient(client, release);
    };
  }
  driver.corvoRlsInstalled = true;
}
