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

  it('accepts chunked framing when the body was probed as empty', () => {
    expect(
      createGuard().canActivate(
        contextFor({ 'transfer-encoding': 'chunked' }, { emptyBody: true }),
      ),
    ).toBe(true);
  });

  it('rejects chunked framing without content type when the body is not empty', () => {
    expect(() =>
      createGuard().canActivate(
        contextFor({ 'transfer-encoding': 'chunked' }, { emptyBody: false }),
      ),
    ).toThrow(new ForbiddenException('Unsupported content type'));
    expect(() =>
      createGuard().canActivate(contextFor({ 'transfer-encoding': 'chunked' })),
    ).toThrow(new ForbiddenException('Unsupported content type'));
  });

  it('rejects text/plain even when the body is flagged empty', () => {
    expect(() =>
      createGuard().canActivate(
        contextFor({ 'content-type': 'text/plain' }, { emptyBody: true }),
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

function contextFor(
  extraHeaders: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  const request = {
    method: 'POST',
    authMode: 'cookie',
    ...extra,
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
