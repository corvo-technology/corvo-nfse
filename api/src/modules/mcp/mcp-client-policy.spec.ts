import {
  isAcceptableRedirectUri,
  isMcpClientId,
  matchesRegisteredRedirectUri,
  parseScopes,
} from './mcp-client-policy';

describe('mcp client policy', () => {
  it('recognises the fixed and dynamic MCP client ids', () => {
    expect(isMcpClientId('corvo-mcp')).toBe(true);
    expect(isMcpClientId('corvo-mcp-AbCdEfGh12345678')).toBe(true);
    expect(isMcpClientId('corvo-web')).toBe(false);
    expect(isMcpClientId('corvo-mcp-short')).toBe(false);
  });

  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:54321/callback', true],
    ['http://127.0.0.1/callback', true],
    ['cursor://anysphere.cursor-retrieval/oauth/callback', true],
    ['http://example.com/callback', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['https://user:pass@example.com/cb', false],
    ['https://example.com/cb#frag', false],
    ['not a url', false],
  ])('redirect uri %s acceptable=%s', (uri, expected) => {
    expect(isAcceptableRedirectUri(uri)).toBe(expected);
  });

  it('matches loopback redirects on any port but everything else exactly', () => {
    const registered = ['http://localhost:1111/callback', 'https://a.test/cb'];
    expect(
      matchesRegisteredRedirectUri(
        registered,
        'http://localhost:2222/callback',
      ),
    ).toBe(true);
    expect(
      matchesRegisteredRedirectUri(registered, 'http://localhost:2222/other'),
    ).toBe(false);
    expect(
      matchesRegisteredRedirectUri(
        registered,
        'http://127.0.0.1:1111/callback',
      ),
    ).toBe(false);
    expect(matchesRegisteredRedirectUri(registered, 'https://a.test/cb')).toBe(
      true,
    );
    expect(
      matchesRegisteredRedirectUri(registered, 'https://a.test:444/cb'),
    ).toBe(false);
  });

  it('keeps only known scopes without duplicates', () => {
    expect(parseScopes('nfse:read nfse:read admin nfse:write')).toEqual([
      'nfse:read',
      'nfse:write',
    ]);
    expect(parseScopes('')).toEqual([]);
  });
});
