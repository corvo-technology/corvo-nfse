import type {
  PlatformQuery,
  PlatformReadSession,
} from '../platform-read-session';
import {
  escapeLike,
  PlatformUsersReadRepository,
  searchDigits,
} from './platform-users.read-repository';
import { encodeCursor } from '@/shared/http/pagination';

function sessionWith(rows: unknown[][]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const q = jest.fn((sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve((rows.shift() ?? []) as never[]);
  }) as unknown as PlatformQuery;
  const session = {
    run: <T>(work: (q: PlatformQuery) => Promise<T>) => work(q),
  } as unknown as PlatformReadSession;
  return { session, calls };
}

describe('platform users read helpers', () => {
  it('escapeLike escapa % _ e \\', () =>
    expect(escapeLike('50%_a\\')).toBe('50\\%\\_a\\\\'));
  it('searchDigits tira a máscara do CNPJ', () =>
    expect(searchDigits('12.345.678/0001-95')).toBe('12345678000195'));
});

describe('PlatformUsersReadRepository.list', () => {
  it('limit 1000 vira 50 na consulta', async () => {
    const { session, calls } = sessionWith([[]]);
    const page = await new PlatformUsersReadRepository(session).list({
      limit: 1000,
    });
    expect(calls[0].params).toContain(51);
    expect(page.pagination.limit).toBe(50);
  });

  it('sem limit usa 50', async () => {
    const { session, calls } = sessionWith([[]]);
    await new PlatformUsersReadRepository(session).list({});
    expect(calls[0].params).toContain(51);
  });

  it('cursor inválido responde 400 ERROR_INVALID_CURSOR', async () => {
    const { session } = sessionWith([[]]);
    await expect(
      new PlatformUsersReadRepository(session).list({
        limit: 10,
        cursor: 'nao-e-cursor',
      }),
    ).rejects.toMatchObject({ response: { code: 'ERROR_INVALID_CURSOR' } });
  });

  it('cursor de outra busca é recusado', async () => {
    const { session } = sessionWith([[]]);
    const cursor = encodeCursor({
      v: 1,
      scope: 'x',
      sort: '2026-01-01T00:00:00.000000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
    await expect(
      new PlatformUsersReadRepository(session).list({ limit: 10, cursor }),
    ).rejects.toMatchObject({ response: { code: 'ERROR_INVALID_CURSOR' } });
  });

  it('passa o termo escapado como parâmetro, nunca no SQL', async () => {
    const { session, calls } = sessionWith([[]]);
    await new PlatformUsersReadRepository(session).list({
      limit: 10,
      search: '50%_',
    });
    expect(calls[0].params).toContain('50\\%\\_');
    expect(calls[0].sql).not.toContain('50%');
  });
});
