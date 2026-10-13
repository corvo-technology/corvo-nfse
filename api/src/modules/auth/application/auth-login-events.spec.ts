import { AuthLoginRecordedListener } from './auth-login-events';

describe(AuthLoginRecordedListener.name, () => {
  it('updates lastLoginAt from a best-effort login event', async () => {
    const authUsers = { markLogin: jest.fn().mockResolvedValue(undefined) };
    const listener = new AuthLoginRecordedListener(authUsers as never);
    const occurredAt = new Date('2026-08-11T12:00:00.000Z');

    await listener.onLoginRecorded({
      name: 'auth.login.recorded',
      authUserId: 'auth-user-1',
      occurredAt,
    });

    expect(authUsers.markLogin).toHaveBeenCalledWith('auth-user-1', occurredAt);
  });
});
