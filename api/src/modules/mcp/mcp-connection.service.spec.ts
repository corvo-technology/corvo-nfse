import { NotFoundException } from '@nestjs/common';
import * as sentry from '@/infra/observability/sentry-reporter';
import { runWithAuditActor } from '@/modules/account-audit/application/audit-actor.context';
import type { AccountAuditRecorder } from '@/modules/account-audit/domain/account-audit';
import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { failingAccountAudit } from '@/modules/account-audit/testing/failing-account-audit';
import type { AuthContext } from '../auth/auth-context';
import type { McpConnection } from './domain/mcp-connection';
import { McpConnectionService } from './mcp-connection.service';

const TENANT = '22222222-2222-4222-8222-222222222222';
const OWNER = '11111111-1111-4111-8111-111111111111';

function connection(over: Partial<McpConnection> = {}): McpConnection {
  return {
    id: 'conn-1',
    authUserId: OWNER,
    tenantId: TENANT,
    clientId: 'client-1',
    sessionId: 'sess-1',
    scopes: ['nfse:read'],
    environment: 'live',
    grantedAt: new Date(),
    revokedAt: null,
    lastUsedAt: null,
    toolCallsCount: 0,
    invoicesIssuedCount: 0,
    ...over,
  };
}

function auth(over: Partial<AuthContext> = {}): AuthContext {
  return {
    authUserId: OWNER,
    activeTenantId: TENANT,
    permissions: [],
    ...over,
  } as AuthContext;
}

function build(
  opts: { row?: McpConnection | null; audit?: AccountAuditRecorder } = {},
) {
  const row = opts.row === undefined ? connection() : opts.row;
  const repo = {
    findById: jest.fn().mockResolvedValue(row),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = { revokeTenantSession: jest.fn().mockResolvedValue(true) };
  const authAudit = { save: jest.fn().mockResolvedValue(undefined) };
  const clients = {
    findById: jest.fn().mockResolvedValue({ id: 'client-1', name: 'Claude' }),
  };
  const audit = opts.audit ?? new FakeAccountAudit();
  const service = new McpConnectionService(
    repo as never,
    sessions as never,
    authAudit,
    {} as never,
    clients as never,
    {} as never,
    audit,
  );
  return { service, repo, sessions, audit: audit as FakeAccountAudit };
}

describe('McpConnectionService.revoke audit', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records agent.disconnected with the client name, as the requester', async () => {
    const f = build();
    await runWithAuditActor({ type: 'user', id: OWNER }, () =>
      f.service.revoke('conn-1', auth()),
    );
    expect(f.audit.events).toHaveLength(1);
    expect(f.audit.events[0]).toMatchObject({
      tenantId: TENANT,
      environment: 'live',
      action: 'agent.disconnected',
      actor: { type: 'user', id: OWNER },
      target: { type: 'agent_connection', id: 'conn-1', label: 'Claude' },
    });
  });

  it('records nothing for a connection that was already revoked', async () => {
    const f = build({ row: connection({ revokedAt: new Date() }) });
    await f.service.revoke('conn-1', auth());
    expect(f.audit.events).toHaveLength(0);
    expect(f.repo.revoke).not.toHaveBeenCalled();
  });

  it('records nothing when the connection is not found or not the requester', async () => {
    const missing = build({ row: null });
    await expect(missing.service.revoke('x', auth())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const other = build({ row: connection({ authUserId: 'someone-else' }) });
    await expect(other.service.revoke('conn-1', auth())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(missing.audit.events).toHaveLength(0);
    expect(other.audit.events).toHaveLength(0);
  });

  it('keeps the revocation when the recorder fails', async () => {
    jest.spyOn(sentry, 'captureRuntimeException').mockReturnValue(undefined);
    const f = build({ audit: failingAccountAudit() });
    await expect(f.service.revoke('conn-1', auth())).resolves.toBeUndefined();
    expect(f.repo.revoke).toHaveBeenCalled();
    expect(f.sessions.revokeTenantSession).toHaveBeenCalled();
  });
});
