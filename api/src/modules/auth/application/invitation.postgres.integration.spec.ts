import { FakeAccountAudit } from '@/modules/account-audit/testing/fake-account-audit';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { createTypeOrmOptions } from '@/infra/database/typeorm.options';
import { installRlsConnectionScope } from '@/infra/database/rls-connection-scope';
import { RlsConnectionScopeService } from '@/infra/database/rls-connection-scope.service';
import { TypeOrmRepositoryHelper } from '@/infra/persistence/typeorm/typeorm-repository.helper';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmUnitOfWork } from '@/infra/persistence/typeorm/typeorm-unit-of-work';
import { TypeOrmTenantInvitationRepository } from '@/infra/persistence/typeorm/repositories/tenant-invitation.repository';
import { TypeOrmTenantMembershipRepository } from '@/infra/persistence/typeorm/repositories/tenant-membership.repository';
import { TypeOrmAuthUserRepository } from '@/infra/persistence/typeorm/repositories/auth.repositories';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';
import { ApplicationEventBus } from '@/shared/events/application-event-bus';
import {
  ACCOUNT_NOTICE,
  type AccountNotice,
} from '@/shared/events/account-notice.events';
import { AuthUserService } from './auth-user.service';
import { MembershipService } from './membership.service';
import { InvitationService, hashInvitationToken } from './invitation.service';

/**
 * Public-link flow (preview / accept) through the real RLS scope hook, on a
 * NOBYPASSRLS role: the invitee is signed in to THEIR OWN workspace (the request
 * is wrapped in that tenant, like the interceptor does) while the invitation
 * and the membership belong to ANOTHER tenant.
 */
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test'))
)
  throw new Error('Invitation integration requires a local _test database');
const describePostgres = url ? describe : describe.skip;
const schema = `inv_test_${randomUUID().replaceAll('-', '')}`;
const role = `${schema}_runtime`;

describePostgres('invitation links with strict RLS', () => {
  let admin: DataSource;
  let runtime: DataSource;
  let service: InvitationService;
  const notices: Array<Extract<AccountNotice, { kind: 'member-invited' }>> = [];
  const table = (name: string) => `"${schema}"."${name}"`;

  const ownerId = randomUUID();
  const verified = new Date('2026-11-01T00:00:00Z');

  beforeAll(async () => {
    admin = new DataSource(
      createTypeOrmOptions({ url: url!, schema, ssl: false, logging: false }),
    );
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.runMigrations();
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [
      ownerId,
    ]);
    await admin.query(
      `INSERT INTO ${table('auth_users')} (id,email,name,email_verified_at) VALUES ($1,'dona@example.invalid','Dona Maria',now())`,
      [ownerId],
    );
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$1,'admin')`,
      [ownerId],
    );
    const password = randomBytes(24).toString('hex');
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    const [owner]: Array<{ role: string }> = await admin.query(
      'SELECT current_user AS role',
    );
    execFileSync(
      'psql',
      [
        url!,
        '-w',
        '-v',
        `runtime_role=${role}`,
        '-v',
        `migration_role=${owner.role}`,
        '-v',
        `app_schema=${schema}`,
        '-f',
        resolve(process.cwd(), 'scripts/provision-runtime-role.sql'),
      ],
      { stdio: 'pipe' },
    );
    const runtimeUrl = new URL(url!);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    const options = createTypeOrmOptions({
      url: runtimeUrl.toString(),
      schema,
      ssl: false,
      logging: false,
    });
    runtime = new DataSource({
      ...options,
      extra: { ...options.extra, max: 1 },
    });
    await runtime.initialize();
    installRlsConnectionScope(runtime);
    await new RlsConnectionScopeService(runtime).onModuleInit();

    const context = new TypeOrmTransactionContext();
    const helper = new TypeOrmRepositoryHelper(runtime, context);
    const emitter = new EventEmitter2();
    emitter.on(ACCOUNT_NOTICE, (event: { notice: AccountNotice }) => {
      if (event.notice.kind === 'member-invited') notices.push(event.notice);
    });
    const bus = new ApplicationEventBus(emitter);
    service = new InvitationService(
      new TypeOrmTenantInvitationRepository(helper),
      new AuthUserService(new TypeOrmAuthUserRepository(helper)),
      new MembershipService(
        new TypeOrmTenantMembershipRepository(helper),
        bus,
        new FakeAccountAudit(),
      ),
      bus,
      new TypeOrmUnitOfWork(runtime, context),
      new FakeAccountAudit(),
    );
  }, 180000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.destroy();
    }
  });

  /** A person who signed in: own workspace (tenant id = user id), like the login bootstrap. */
  const signUp = async (email: string, over: { verified?: boolean } = {}) => {
    const id = randomUUID();
    await admin.query(`INSERT INTO ${table('tenants')} (id) VALUES ($1)`, [id]);
    await admin.query(
      `INSERT INTO ${table('auth_users')} (id,email,name,email_verified_at) VALUES ($1,$2,$3,$4)`,
      [
        id,
        email,
        email.split('@')[0],
        over.verified === false ? null : verified,
      ],
    );
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$1,'admin')`,
      [id],
    );
    return id;
  };

  /** The request wrapper: every authenticated call runs inside the caller's active tenant. */
  const asUser = <T>(tenantId: string, work: () => Promise<T>) =>
    runWithTenant(tenantId, work);

  const invite = async (email: string, name = 'Fulano', roleName = 'admin') => {
    notices.length = 0;
    await asUser(ownerId, () =>
      service.invite(ownerId, ownerId, {
        email,
        name,
        role: roleName as 'admin',
      }),
    );
    return notices[notices.length - 1].token;
  };

  const memberships = async (
    userId: string,
  ): Promise<Array<{ tenant_id: string; role: string; is_active: boolean }>> =>
    admin.query(
      `SELECT tenant_id, role, is_active FROM ${table('tenant_memberships')} WHERE auth_user_id=$1 ORDER BY created_at`,
      [userId],
    );

  it('new user with only their own workspace: preview shows who invited, accept joins the inviter workspace with the invited role', async () => {
    const token = await invite('novo@example.invalid');
    const userId = await signUp('novo@example.invalid');
    const preview = await asUser(userId, () => service.preview(userId, token));
    expect(preview).toEqual({ role: 'admin', invitedBy: 'Dona Maria' });
    const result = await asUser(userId, () => service.accept(userId, token));
    expect(result).toEqual({ tenantId: ownerId, role: 'admin' });
    expect(await memberships(userId)).toEqual([
      expect.objectContaining({ tenant_id: userId }),
      expect.objectContaining({
        tenant_id: ownerId,
        role: 'admin',
        is_active: true,
      }),
    ]);
    const [invitation]: Array<Record<string, unknown>> = await admin.query(
      `SELECT status, accepted_at, token_hash FROM ${table('tenant_invitations')} WHERE accepted_by_user_id=$1`,
      [userId],
    );
    expect(invitation).toMatchObject({
      status: 'completed',
      token_hash: null,
    });
    expect(invitation.accepted_at).toBeInstanceOf(Date);
    // The reused link no longer works.
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_INVALID' } });
  });

  it('the e-mail typed with other casing and spaces still matches the signed-in account', async () => {
    const token = await invite(
      '  Caixa.Alta@Example.Invalid ',
      'Caixa',
      'developer',
    );
    const userId = await signUp('CAIXA.ALTA@example.invalid');
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).resolves.toEqual({ tenantId: ownerId, role: 'developer' });
  });

  it('another account cannot use the link, and the link survives the failed try', async () => {
    const token = await invite('certo@example.invalid');
    const intruder = await signUp('errado@example.invalid');
    await expect(
      asUser(intruder, () => service.accept(intruder, token)),
    ).rejects.toMatchObject({
      response: { code: 'INVITATION_EMAIL_MISMATCH' },
    });
    await expect(
      asUser(intruder, () => service.preview(intruder, token)),
    ).rejects.toMatchObject({
      response: { code: 'INVITATION_EMAIL_MISMATCH' },
    });
    const right = await signUp('certo@example.invalid');
    await expect(
      asUser(right, () => service.accept(right, token)),
    ).resolves.toMatchObject({ tenantId: ownerId });
  });

  it('an account whose e-mail was never proven cannot accept', async () => {
    const token = await invite('naoverificado@example.invalid');
    const userId = await signUp('naoverificado@example.invalid', {
      verified: false,
    });
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).rejects.toMatchObject({
      response: { code: 'INVITATION_EMAIL_MISMATCH' },
    });
  });

  it('expired invitation: clear 410, nothing joined', async () => {
    const token = await invite('vencido@example.invalid');
    await admin.query(
      `UPDATE ${table('tenant_invitations')} SET expires_at = now() - interval '1 hour' WHERE token_hash=$1`,
      [hashInvitationToken(token)],
    );
    const userId = await signUp('vencido@example.invalid');
    await expect(
      asUser(userId, () => service.preview(userId, token)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_EXPIRED' } });
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_EXPIRED' } });
    expect(await memberships(userId)).toHaveLength(1);
  });

  it('revoked invitation is invalid', async () => {
    const token = await invite('revogado@example.invalid');
    const [{ id }]: Array<{ id: string }> = await admin.query(
      `SELECT id FROM ${table('tenant_invitations')} WHERE token_hash=$1`,
      [hashInvitationToken(token)],
    );
    await asUser(ownerId, () => service.revoke(ownerId, id));
    const userId = await signUp('revogado@example.invalid');
    await expect(
      asUser(userId, () => service.preview(userId, token)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_INVALID' } });
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_INVALID' } });
  });

  it('resend extends the expiry and kills the old link', async () => {
    const first = await invite('reenvio@example.invalid');
    const [{ id }]: Array<{ id: string }> = await admin.query(
      `SELECT id FROM ${table('tenant_invitations')} WHERE token_hash=$1`,
      [hashInvitationToken(first)],
    );
    await admin.query(
      `UPDATE ${table('tenant_invitations')} SET expires_at = now() + interval '1 hour', updated_at = now() - interval '5 minutes' WHERE id=$1`,
      [id],
    );
    notices.length = 0;
    const resent = await asUser(ownerId, () => service.resend(ownerId, id));
    const second = notices[notices.length - 1].token;
    expect(second).not.toBe(first);
    expect(resent.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 3_600_000,
    );
    const userId = await signUp('reenvio@example.invalid');
    await expect(
      asUser(userId, () => service.accept(userId, first)),
    ).rejects.toMatchObject({ response: { code: 'INVITATION_INVALID' } });
    await expect(
      asUser(userId, () => service.accept(userId, second)),
    ).resolves.toMatchObject({ tenantId: ownerId });
  });

  it('already a member: the invitation is consumed and nothing is duplicated', async () => {
    const userId = await signUp('jamembro@example.invalid');
    await admin.query(
      `INSERT INTO ${table('tenant_memberships')} (auth_user_id,tenant_id,role) VALUES ($1,$2,'developer')`,
      [userId, ownerId],
    );
    const token = randomBytes(16).toString('hex');
    await admin.query(
      `INSERT INTO ${table('tenant_invitations')} (id,tenant_id,email,name,role,status,token_hash,expires_at) VALUES ($1,$2,'jamembro@example.invalid','X','admin','pending',$3,now()+interval '1 day')`,
      [randomUUID(), ownerId, hashInvitationToken(token)],
    );
    await expect(
      asUser(userId, () => service.accept(userId, token)),
    ).resolves.toMatchObject({ tenantId: ownerId });
    expect(
      (await memberships(userId)).filter((m) => m.tenant_id === ownerId),
    ).toHaveLength(1);
  });

  it('the admin list keeps an expired invitation, flagged, so it can be resent', async () => {
    const token = await invite('naolista@example.invalid');
    await admin.query(
      `UPDATE ${table('tenant_invitations')} SET expires_at = now() - interval '1 day', updated_at = now() - interval '2 days' WHERE token_hash=$1`,
      [hashInvitationToken(token)],
    );
    const listed = await asUser(ownerId, () => service.listOpen(ownerId));
    const mine = listed.find((i) => i.email === 'naolista@example.invalid');
    expect(mine).toMatchObject({ expired: true });
    const resent = await asUser(ownerId, () =>
      service.resend(ownerId, mine!.id),
    );
    expect(resent.expired).toBe(false);
  });

  it('an invitation of one tenant is never listed under another tenant', async () => {
    await invite('listado@example.invalid');
    const userId = await signUp('quemvisita@example.invalid');
    await expect(
      asUser(userId, () => service.listOpen(userId)),
    ).resolves.toEqual([]);
    expect(
      (await asUser(ownerId, () => service.listOpen(ownerId))).length,
    ).toBeGreaterThan(0);
  });
});
