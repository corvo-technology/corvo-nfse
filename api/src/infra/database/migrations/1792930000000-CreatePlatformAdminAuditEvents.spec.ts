import type { QueryRunner } from 'typeorm';
import { CreatePlatformAdminAuditEvents1792930000000 } from './1792930000000-CreatePlatformAdminAuditEvents';

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

describe('CreatePlatformAdminAuditEvents', () => {
  it('migração cria a tabela sem RLS e com o índice único parcial', async () => {
    const { runner, queries } = fakeRunner();
    await new CreatePlatformAdminAuditEvents1792930000000().up(runner);
    const sql = queries.join('\n');
    expect(sql).toMatch(/CREATE TABLE "corvo"\.platform_admin_audit_events/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX uq_platform_admin_audit_grant_key ON "corvo"\.platform_admin_audit_events \(idempotency_key\) WHERE action = 'credit_grant' AND success/,
    );
    expect(sql).toMatch(
      /idx_platform_admin_audit_created .*\(created_at DESC, id DESC\)/,
    );
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/REFERENCES/i);
  });

  it('down remove a tabela', async () => {
    const { runner, queries } = fakeRunner();
    await new CreatePlatformAdminAuditEvents1792930000000().down(runner);
    expect(queries[0]).toMatch(
      /DROP TABLE IF EXISTS "corvo"\.platform_admin_audit_events/,
    );
  });
});
