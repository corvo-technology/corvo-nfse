import { ExecutionEnvironmentGuard } from './execution-environment.guard';
import type { AuthContext } from './auth-context';

function request(key?: 'test' | 'live', header?: unknown, body?: unknown) {
  const req = {
    headers: { 'x-corvo-environment': header },
    authContext: { apiKeyEnvironment: key } as AuthContext,
    body,
  };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
  return { req, context };
}

describe('Execution environment boundary', () => {
  const guard = new ExecutionEnvironmentGuard();
  for (const key of ['test', 'live'] as const) {
    for (const header of [
      undefined,
      'test',
      'live',
      'production',
      ['test', 'live'],
    ]) {
      it(`uses API key ${key} exclusively, ignoring header ${JSON.stringify(header)}`, () => {
        const { req, context } = request(key, header);
        expect(guard.canActivate(context)).toBe(true);
        expect(req.authContext.executionEnvironment).toBe(key);
      });
    }
  }
  for (const [header, expected] of [
    [undefined, 'test'],
    ['test', 'test'],
    ['live', 'live'],
  ]) {
    it(`selects ${expected} for dashboard header ${header}`, () => {
      const { req, context } = request(undefined, header);
      guard.canActivate(context);
      expect(req.authContext.executionEnvironment).toBe(expected);
    });
  }
  it('rejects obsolete dashboard values and selectors in JSON', () => {
    expect(() =>
      guard.canActivate(request(undefined, 'sandbox').context),
    ).toThrow('test or live');
    expect(() =>
      guard.canActivate(
        request('test', undefined, { environment: 'live' }).context,
      ),
    ).toThrow('Select the environment');
  });
});
