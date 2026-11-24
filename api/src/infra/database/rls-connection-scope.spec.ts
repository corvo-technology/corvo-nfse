/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';
import {
  classifyTransactionStatement,
  installRlsConnectionScope,
  scopeClient,
  scopeSettingsSql,
} from './rls-connection-scope';
import {
  runAsSystem,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';

type Sent = string | { text: string; values?: unknown[] };
const textOf = (sent: Sent) => (typeof sent === 'string' ? sent : sent.text);

/** A pg client double: records what reaches the socket, in order. */
function fakeClient(respond: (sent: Sent) => unknown = () => ({ rows: [] })) {
  const sent: Sent[] = [];
  const client: any = {
    query: jest.fn((config: Sent) => {
      sent.push(config);
      if (typeof config === 'object' && 'submit' in (config as object))
        return config;
      return new Promise((resolve, reject) =>
        setImmediate(() => {
          try {
            Promise.resolve(respond(config)).then(resolve, reject);
          } catch (error) {
            reject(error as Error);
          }
        }),
      );
    }),
    other: 'kept',
  };
  return { client, sent };
}

const combinedResult = (rows: unknown[] = []) => [
  { command: 'BEGIN' },
  { command: 'SELECT', rows: [] },
  { command: 'SELECT', rows },
  { command: 'COMMIT' },
];

describe('classifyTransactionStatement', () => {
  it.each([
    ['BEGIN', { kind: 'begin' }],
    ['begin;', { kind: 'begin' }],
    ['  \n BEGIN TRANSACTION', { kind: 'begin' }],
    ['BEGIN WORK', { kind: 'begin' }],
    ['-- start\nBEGIN', { kind: 'begin' }],
    ['/* a /* nested */ b */ BEGIN', { kind: 'begin' }],
    ['BEGIN ISOLATION LEVEL SERIALIZABLE', { kind: 'begin' }],
    ['BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY', { kind: 'begin' }],
    ['START TRANSACTION', { kind: 'begin' }],
    ['start  transaction read only', { kind: 'begin' }],
    [
      'START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ WRITE',
      { kind: 'begin' },
    ],
    ['COMMIT', { kind: 'end', chain: false }],
    ['commit;', { kind: 'end', chain: false }],
    ['COMMIT WORK', { kind: 'end', chain: false }],
    ['COMMIT TRANSACTION -- done', { kind: 'end', chain: false }],
    ['END', { kind: 'end', chain: false }],
    ['END TRANSACTION', { kind: 'end', chain: false }],
    ['ABORT', { kind: 'end', chain: false }],
    ['ROLLBACK', { kind: 'end', chain: false }],
    ['ROLLBACK WORK', { kind: 'end', chain: false }],
    ['ROLLBACK AND NO CHAIN', { kind: 'end', chain: false }],
    ['COMMIT AND NO CHAIN', { kind: 'end', chain: false }],
    ['COMMIT AND CHAIN', { kind: 'end', chain: true }],
    ['commit transaction and chain;', { kind: 'end', chain: true }],
    ['ROLLBACK AND CHAIN', { kind: 'end', chain: true }],
    ['ABORT AND CHAIN', { kind: 'end', chain: true }],
    ['SET TRANSACTION READ ONLY', { kind: 'set-transaction' }],
    [
      '  /* c */ set transaction isolation level serializable',
      { kind: 'set-transaction' },
    ],
  ])('%j is a transaction boundary', (text, expected) => {
    expect(classifyTransactionStatement(text)).toEqual(expected);
  });

  it.each([
    'SELECT 1',
    'SELECT * FROM begin_items',
    'SAVEPOINT typeorm_1',
    'RELEASE SAVEPOINT typeorm_1',
    'ROLLBACK TO SAVEPOINT typeorm_1',
    'ROLLBACK TO typeorm_1',
    'ROLLBACK WORK TO SAVEPOINT x',
    'PREPARE stmt AS SELECT 1',
    'SET LOCAL statement_timeout = 1000',
    'INSERT INTO t VALUES (1)',
    '',
    '-- only a comment',
  ])('%j is not a boundary', (text) => {
    expect(classifyTransactionStatement(text)).toBeUndefined();
  });

  it.each([
    "PREPARE TRANSACTION 'x'",
    "COMMIT PREPARED 'x'",
    "ROLLBACK PREPARED 'x'",
    'COMMIT AND',
    'COMMIT NOW',
    'ROLLBACK FOREVER',
    'END; DROP TABLE x',
    'BEGIN; DROP TABLE x',
    'BEGIN (1)',
    "START TRANSACTION 'x'",
  ])('%j fails closed', (text) => {
    expect(() => classifyTransactionStatement(text)).toThrow();
  });
});

describe('scopeClient', () => {
  const A = randomUUID();
  const B = randomUUID();

  it('sends an autocommit statement without parameters as one message and returns only its result', async () => {
    const { client, sent } = fakeClient(() => combinedResult([{ id: 1 }]));
    const [scoped] = scopeClient(client, jest.fn());
    const result: any = await runWithTenant(A, () => scoped.query('SELECT 1;'));
    expect(sent).toHaveLength(1);
    const message = textOf(sent[0]);
    expect(message).toMatch(/^BEGIN;SELECT set_config\(/);
    expect(message).toContain(`'app.current_tenant_id', '${A}', true`);
    expect(message).toMatch(/;\nSELECT 1\n;COMMIT$/);
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(scoped.other).toBe('kept');
  });

  it('keeps a trailing line comment from swallowing the COMMIT', async () => {
    const { client, sent } = fakeClient(() => combinedResult());
    const [scoped] = scopeClient(client, jest.fn());
    await runWithTenant(A, () => scoped.query('SELECT 1 -- note'));
    expect(textOf(sent[0])).toMatch(/\nSELECT 1 -- note\n;COMMIT$/);
  });

  it('sends parameterized and multi-statement texts as three scoped messages', async () => {
    const { client, sent } = fakeClient(() => ({ rows: [] }));
    const [scoped] = scopeClient(client, jest.fn());
    await runWithTenant(A, () => scoped.query('SELECT $1::int', [1]));
    expect(sent.map(textOf)).toEqual([
      expect.stringMatching(/^BEGIN;SELECT set_config\(/),
      'SELECT $1::int',
      'COMMIT',
    ]);
    await runWithTenant(B, () => scoped.query('SELECT 1; SELECT 2'));
    expect(sent.slice(3).map(textOf)).toEqual([
      expect.stringContaining(B),
      'SELECT 1; SELECT 2',
      'COMMIT',
    ]);
  });

  it('serializes concurrent autocommit queries so every one keeps its own scope', async () => {
    const { client, sent } = fakeClient((message) =>
      textOf(message).startsWith('BEGIN;') ? combinedResult() : { rows: [] },
    );
    const [scoped] = scopeClient(client, jest.fn());
    await Promise.all([
      runWithTenant(A, () => scoped.query('SELECT 1 /* a */')),
      runWithTenant(B, () => scoped.query('SELECT 2 /* b */')),
      runAsSystem('outbox-relay', () => scoped.query('SELECT 3 /* s */')),
      runWithTenant(A, () => scoped.query('SELECT $1 /* p */', [1])),
    ]);
    const messages = sent.map(textOf);
    // Each job is contiguous: settings of its scope, then its statement, then COMMIT.
    const jobs = [
      [`${A}`, '/* a */'],
      [`${B}`, '/* b */'],
      [`'app.system_context', 'on'`, '/* s */'],
      [`${A}`, '/* p */'],
    ];
    expect(messages).toHaveLength(1 + 1 + 1 + 3);
    expect(messages[0]).toContain(jobs[0][0]);
    expect(messages[0]).toContain(jobs[0][1]);
    expect(messages[1]).toContain(jobs[1][0]);
    expect(messages[1]).toContain(jobs[1][1]);
    expect(messages[2]).toContain(jobs[2][0]);
    expect(messages[2]).toContain(jobs[2][1]);
    expect(messages[3]).toContain(jobs[3][0]);
    expect(messages[4]).toContain('/* p */');
    expect(messages[5]).toBe('COMMIT');
  });

  it('rolls back and fails when the statement of a single message fails', async () => {
    const { client, sent } = fakeClient((message) => {
      if (textOf(message).includes('boom'))
        throw new Error('syntax error near boom');
      return textOf(message).startsWith('BEGIN;')
        ? combinedResult()
        : { rows: [] };
    });
    const [scoped] = scopeClient(client, jest.fn());
    const [first, second] = await Promise.allSettled([
      runWithTenant(A, () => scoped.query('SELECT boom')),
      runWithTenant(B, () => scoped.query('SELECT 2')),
    ]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('fulfilled');
    const messages = sent.map(textOf);
    // The ROLLBACK lands before the next caller's message.
    expect(messages[1]).toBe('ROLLBACK');
    expect(messages[2]).toContain(B);
  });

  it('fails closed when the scope setup of a parameterized query fails', async () => {
    const { client, sent } = fakeClient((message) => {
      if (textOf(message).startsWith('BEGIN;')) throw new Error('setup failed');
      return { rows: [{ leaked: true }] };
    });
    const [scoped] = scopeClient(client, jest.fn());
    await expect(
      runWithTenant(A, () => scoped.query('SELECT $1::int', [1])),
    ).rejects.toThrow('setup failed');
    // The statement never ran, and the connection was cleaned up.
    expect(sent.map(textOf)).toEqual([
      expect.stringMatching(/^BEGIN;/),
      'ROLLBACK',
    ]);
  });

  it('applies the scope once per transaction, after SET TRANSACTION, and re-applies it on COMMIT AND CHAIN', async () => {
    const { client, sent } = fakeClient();
    const [scoped, release] = scopeClient(client, jest.fn());
    await runWithTenant(A, async () => {
      await scoped.query('START TRANSACTION');
      await scoped.query('SET TRANSACTION READ ONLY');
      await scoped.query('SELECT 1');
      await scoped.query('SELECT 2');
      await scoped.query('COMMIT AND CHAIN');
      await scoped.query('SELECT 3');
      await scoped.query('ROLLBACK AND CHAIN');
      await scoped.query('SELECT 4');
      await scoped.query('COMMIT');
    });
    const kinds = sent.map((item) =>
      textOf(item).startsWith('SELECT set_config') ? 'scope' : textOf(item),
    );
    expect(kinds).toEqual([
      'START TRANSACTION',
      'SET TRANSACTION READ ONLY',
      'scope',
      'SELECT 1',
      'SELECT 2',
      'COMMIT AND CHAIN',
      'scope',
      'SELECT 3',
      'ROLLBACK AND CHAIN',
      'scope',
      'SELECT 4',
      'COMMIT',
    ]);
    // The transaction is over: releasing is fine.
    const forward = jest.fn();
    const [, releaseAgain] = scopeClient(fakeClient().client, forward);
    releaseAgain();
    expect(forward).toHaveBeenCalledWith(undefined);
    release();
  });

  it.each([
    'BEGIN ISOLATION LEVEL SERIALIZABLE',
    'START TRANSACTION READ ONLY',
    '/* c */ BEGIN',
  ])('treats %j as the start of a scoped transaction', async (begin) => {
    const { client, sent } = fakeClient();
    const [scoped] = scopeClient(client, jest.fn());
    await runWithTenant(A, async () => {
      await scoped.query(begin);
      await scoped.query('SELECT 1');
      await scoped.query('END');
    });
    expect(sent.map(textOf)).toEqual([
      begin,
      expect.stringContaining(`'${A}'`),
      'SELECT 1',
      'END',
    ]);
  });

  it('fails closed on PREPARE TRANSACTION and unknown control statements', async () => {
    const { client, sent } = fakeClient();
    const [scoped] = scopeClient(client, jest.fn());
    await expect(scoped.query("PREPARE TRANSACTION 'x'")).rejects.toThrow(
      'PREPARE TRANSACTION',
    );
    await expect(scoped.query('COMMIT FOREVER')).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('refuses to release a connection inside an open transaction', async () => {
    const { client } = fakeClient();
    const forward = jest.fn();
    const [scoped, release] = scopeClient(client, forward);
    await scoped.query('BEGIN');
    release();
    expect(forward).toHaveBeenCalledWith(expect.any(Error));
  });

  describe('streams (Submittable)', () => {
    const stream = () => ({ submit: jest.fn(), on: jest.fn() });

    it('returns the submittable synchronously inside a transaction, after the scope settings', async () => {
      const { client, sent } = fakeClient();
      const [scoped] = scopeClient(client, jest.fn());
      await runWithTenant(A, () => scoped.query('BEGIN'));
      const submittable = stream();
      const returned = scoped.query(submittable);
      expect(returned).toBe(submittable);
      expect((returned as any).on).toBeDefined();
      expect(textOf(sent[1])).toContain(`'${A}'`);
      expect(sent[2]).toBe(submittable);
      // The scope is applied once only.
      const second = stream();
      expect(scoped.query(second)).toBe(second);
      expect(sent).toHaveLength(4);
    });

    it('does not leak an unhandled rejection when the settings fail', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const { client } = fakeClient((message) => {
          if (textOf(message).startsWith('SELECT set_config'))
            throw new Error('settings failed');
          return { rows: [] };
        });
        const [scoped] = scopeClient(client, jest.fn());
        await runWithTenant(A, () => scoped.query('BEGIN'));
        scoped.query(stream());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('throws a clear error outside an explicit transaction', () => {
      const { client, sent } = fakeClient();
      const [scoped] = scopeClient(client, jest.fn());
      expect(() => scoped.query(stream())).toThrow(
        /require an explicit transaction/,
      );
      expect(sent).toHaveLength(0);
    });
  });

  it('supports the node-style callback', async () => {
    const { client } = fakeClient(() => combinedResult([{ ok: 1 }]));
    const [scoped] = scopeClient(client, jest.fn());
    const result: any = await new Promise((resolve, reject) =>
      scoped.query('SELECT 1', (error: Error | null, value: unknown) =>
        error ? reject(error) : resolve(value),
      ),
    );
    expect(result.rows).toEqual([{ ok: 1 }]);
  });
});

describe('never wraps a client twice', () => {
  it('returns an already wrapped client untouched', () => {
    const { client } = fakeClient();
    const [once, release] = scopeClient(client, jest.fn());
    const [twice, releaseAgain] = scopeClient(once, release);
    expect(twice).toBe(once);
    expect(releaseAgain).toBe(release);
  });

  function fakeDriver(withReplicas: boolean) {
    const { client, sent } = fakeClient(() => combinedResult());
    const driver: any = {
      obtainMasterConnection: async () => [client, jest.fn()],
      obtainSlaveConnection(this: any) {
        // TypeORM: no replicas -> the (already wrapped) master connection.
        return withReplicas
          ? Promise.resolve([client, jest.fn()])
          : this.obtainMasterConnection();
      },
    };
    installRlsConnectionScope({ driver });
    return { driver, sent };
  }

  it.each([false, true])(
    'sends one scoped message per statement (replicas: %s)',
    async (withReplicas) => {
      const { driver, sent } = fakeDriver(withReplicas);
      for (const obtain of [
        'obtainMasterConnection',
        'obtainSlaveConnection',
      ]) {
        sent.length = 0;
        const [client] = await driver[obtain]();
        await runWithTenant(randomUUID(), () => client.query('SELECT 1'));
        expect(sent).toHaveLength(1);
        expect(textOf(sent[0]).match(/BEGIN;/g)).toHaveLength(1);
      }
    },
  );

  it('installs only once', async () => {
    const { driver } = fakeDriver(false);
    const wrapped = driver.obtainMasterConnection;
    installRlsConnectionScope({ driver });
    expect(driver.obtainMasterConnection).toBe(wrapped);
  });
});

describe('scopeSettingsSql', () => {
  it('rejects values that are not plain identifiers', () => {
    expect(() => scopeSettingsSql({ tenantId: "a'b" })).toThrow(
      'Invalid database scope value',
    );
  });
});
