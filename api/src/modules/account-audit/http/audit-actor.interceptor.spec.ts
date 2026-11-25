import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { hashIp } from '@/modules/platform-admin/infra/platform-admin-audit.repository';
import type { AuditActorRef } from '../domain/account-audit';
import { AuditActorInterceptor } from './audit-actor.interceptor';
import { currentAuditActor } from '../application/audit-actor.context';

const HMAC_KEY = 'k'.repeat(40);
const config = { getOrThrow: () => ({ hmacSecret: HMAC_KEY }) };

function run(
  request: Record<string, unknown>,
): Promise<AuditActorRef | undefined> {
  const interceptor = new AuditActorInterceptor(config as never);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return lastValueFrom(
    interceptor.intercept(context, {
      handle: () => of(currentAuditActor()),
    }),
  ) as Promise<AuditActorRef | undefined>;
}

describe('AuditActorInterceptor', () => {
  it('maps an MCP bearer to an agent acting for the user', async () => {
    const actor = await run({
      authContext: { mcpConnectionId: 'c1', authUserId: 'u1' },
    });
    expect(actor).toMatchObject({
      type: 'agent',
      id: 'c1',
      onBehalfOfUserId: 'u1',
    });
  });

  it('maps an API key request to the key id', async () => {
    const actor = await run({
      authContext: { principalType: 'api_key', authUserId: 'u1' },
      validatedApiKeyId: 'k1',
    });
    expect(actor).toMatchObject({ type: 'api_key', id: 'k1' });
  });

  it('maps a cookie session to the user', async () => {
    const actor = await run({ authContext: { authUserId: 'u1' } });
    expect(actor).toMatchObject({ type: 'user', id: 'u1' });
  });

  it('leaves no actor when the request has no authContext', async () => {
    expect(await run({})).toBeUndefined();
  });

  it('stores only a hash of the client ip', async () => {
    const actor = await run({
      authContext: { authUserId: 'u1' },
      ip: '203.0.113.9',
      headers: {},
    });
    expect(actor?.ipHash).toBe(hashIp('203.0.113.9', HMAC_KEY));
    expect(JSON.stringify(actor)).not.toContain('203.0.113.9');
  });
});
