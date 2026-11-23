import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  getDatabaseScope,
  runWithTenant,
} from '@/infra/persistence/typeorm/tenant-context.storage';
import { PlatformReadSession } from './platform-read-session';

const makeRunner = (calls: string[], queryImpl?: (sql: string) => unknown) => ({
  connect: jest.fn(async () => void calls.push('connect')),
  startTransaction: jest.fn(async () => void calls.push('start')),
  query: jest.fn(async (sql: string) => {
    calls.push(`query:${sql}`);
    return queryImpl ? queryImpl(sql) : [];
  }),
  commitTransaction: jest.fn(async () => void calls.push('commit')),
  rollbackTransaction: jest.fn(async () => void calls.push('rollback')),
  release: jest.fn(async () => void calls.push('release')),
});

const sessionFor = (runner: ReturnType<typeof makeRunner>) =>
  new PlatformReadSession({
    createQueryRunner: () => runner,
  } as unknown as DataSource);

describe('PlatformReadSession', () => {
  it('abre transação e roda SET TRANSACTION READ ONLY antes de qualquer consulta', async () => {
    const calls: string[] = [];
    await sessionFor(makeRunner(calls)).run(async (q) => {
      await q('SELECT 1');
    });
    expect(calls).toEqual([
      'connect',
      'start',
      'query:SET TRANSACTION READ ONLY',
      'query:SELECT 1',
      'commit',
      'release',
    ]);
  });

  it('repassa parâmetros e devolve as linhas', async () => {
    const runner = makeRunner([], (sql) =>
      sql === 'SELECT $1' ? [{ a: 1 }] : [],
    );
    const rows = await sessionFor(runner).run((q) => q('SELECT $1', ['x']));
    expect(rows).toEqual([{ a: 1 }]);
    expect(runner.query).toHaveBeenLastCalledWith('SELECT $1', ['x']);
  });

  it('faz rollback e libera quando o trabalho lança', async () => {
    const calls: string[] = [];
    await expect(
      sessionFor(makeRunner(calls)).run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual([
      'connect',
      'start',
      'query:SET TRANSACTION READ ONLY',
      'rollback',
      'release',
    ]);
  });

  it('libera e preserva o erro original se o rollback falhar', async () => {
    const runner = makeRunner([]);
    runner.rollbackTransaction.mockRejectedValueOnce(new Error('rb'));
    await expect(
      sessionFor(runner).run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(runner.release).toHaveBeenCalled();
  });

  it('roda sob o escopo system platform-admin e sem tenant, mesmo dentro de runWithTenant', async () => {
    const runner = makeRunner([]);
    let atConnect: unknown;
    runner.connect.mockImplementation(async () => {
      atConnect = getDatabaseScope();
    });
    let seen: unknown;
    await runWithTenant(randomUUID(), () =>
      sessionFor(runner).run(async () => {
        seen = getDatabaseScope();
      }),
    );
    expect(seen).toEqual({ system: 'platform-admin' });
    expect(atConnect).toEqual({ system: 'platform-admin' });
  });
});
