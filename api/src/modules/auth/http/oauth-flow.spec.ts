import { createOAuthState, readOAuthState, safeNextPath } from './oauth-flow';

describe('safeNextPath', () => {
  it('keeps the MCP consent page with its query', () => {
    expect(safeNextPath('/mcp/authorize?client_id=x&state=y')).toBe(
      '/mcp/authorize?client_id=x&state=y',
    );
  });

  it.each([
    undefined,
    '',
    'https://evil.example/app',
    '//evil.example',
    '/\\evil.example',
    '/app/billing',
    '/mcp/authorize/../../x',
    '/login',
  ])('falls back to the dashboard for %p', (next) => {
    expect(safeNextPath(next)).toBe('/app');
  });
});

describe('OAuth state', () => {
  it('round-trips the nonce and where to resume', () => {
    const { state, cookieValue } = createOAuthState(
      '/mcp/authorize?client_id=x',
    );
    expect(readOAuthState(cookieValue, state)).toEqual({
      next: '/mcp/authorize?client_id=x',
    });
  });

  it('uses a new unguessable nonce each time', () => {
    const a = createOAuthState(undefined);
    const b = createOAuthState(undefined);
    expect(a.state).not.toBe(b.state);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
  });

  it('rejects a state that does not match the cookie', () => {
    const { cookieValue } = createOAuthState(undefined);
    expect(readOAuthState(cookieValue, 'forged')).toBeNull();
  });

  it('rejects a missing cookie or state', () => {
    const { state, cookieValue } = createOAuthState(undefined);
    expect(readOAuthState(undefined, state)).toBeNull();
    expect(readOAuthState(cookieValue, undefined)).toBeNull();
    expect(readOAuthState('nodot', 'nodot')).toBeNull();
  });

  it('never resumes on an external address even if the cookie is tampered with', () => {
    const { state } = createOAuthState(undefined);
    const tampered = `${state}.${Buffer.from('https://evil.example').toString('base64url')}`;
    expect(readOAuthState(tampered, state)).toEqual({ next: '/app' });
  });
});
