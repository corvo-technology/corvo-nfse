import type { QueryRunner } from 'typeorm';
import { AddAuthUserLastLoginAt1792920000000 } from './1792920000000-AddAuthUserLastLoginAt';

function fakeRunner() {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve(undefined);
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('AddAuthUserLastLoginAt', () => {
  it('up adds the nullable last_login_at timestamptz column', async () => {
    const { runner, queries } = fakeRunner();
    await new AddAuthUserLastLoginAt1792920000000().up(runner);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(
      /"corvo"\.auth_users\s+ADD COLUMN last_login_at timestamptz/,
    );
    expect(queries[0]).not.toMatch(/NOT NULL/i);
  });

  it('down drops the column', async () => {
    const { runner, queries } = fakeRunner();
    await new AddAuthUserLastLoginAt1792920000000().down(runner);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(
      /"corvo"\.auth_users\s+DROP COLUMN last_login_at/,
    );
  });
});
