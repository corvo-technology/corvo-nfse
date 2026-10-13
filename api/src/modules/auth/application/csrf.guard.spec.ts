import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  it('accepts a cookie-session mutation with an empty body and no content type', () => {
    const guard = createGuard();

    expect(
      guard.canActivate(
        contextFor({
          'content-length': '0',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a mutation with a body and no supported content type', () => {
    const guard = createGuard();

    expect(() =>
      guard.canActivate(
        contextFor({
          'content-length': '2',
        }),
      ),
    ).toThrow(new ForbiddenException('Unsupported content type'));
  });
});

function createGuard(): CsrfGuard {
  return new CsrfGuard(
    { validateToken: jest.fn().mockReturnValue(true) } as never,
    { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
    {
      getOrThrow: jest.fn().mockReturnValue({
        corsOrigins: ['http://localhost:8080'],
      }),
    } as never,
  );
}

function contextFor(extraHeaders: Record<string, string>) {
  const request = {
    method: 'POST',
    authMode: 'cookie',
    authContext: { sessionId: 'session-1' },
    headers: {
      origin: 'http://localhost:8080',
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': 'csrf-token',
      ...extraHeaders,
    },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}
