import type { QueryRunner } from 'typeorm';
import { AddAuthUserSignupAttribution1792400000000 } from './1792400000000-AddAuthUserSignupAttribution';

function fakeRunner() {
  const queries: string[] = [];
  const runner = {
    connection: {
      options: { schema: 'corvo' },
      driver: { escape: (v: string) => `"${v}"` },
    },
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return undefined;
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('AddAuthUserSignupAttribution', () => {
  it('adds the nullable signup_attribution jsonb column', async () => {
    const { runner, queries } = fakeRunner();
    await new AddAuthUserSignupAttribution1792400000000().up(runner);
    expect(queries.join('\n')).toMatch(
      /ALTER TABLE "corvo"\.auth_users\s+ADD COLUMN IF NOT EXISTS signup_attribution jsonb NULL/,
    );
  });

  it('drops the column on down', async () => {
    const { runner, queries } = fakeRunner();
    await new AddAuthUserSignupAttribution1792400000000().down(runner);
    expect(queries.join('\n')).toMatch(
      /ALTER TABLE "corvo"\.auth_users DROP COLUMN IF EXISTS signup_attribution/,
    );
  });
});
