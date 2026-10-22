/** The pre-registered first-party OAuth client. */
export const MCP_CLIENT_ID = 'corvo-mcp';
/** Clients created through dynamic registration (RFC 7591) get this prefix. */
export const MCP_DYNAMIC_CLIENT_PREFIX = 'corvo-mcp-';
export const MCP_SCOPES = ['nfse:read', 'nfse:write'] as const;
export const MCP_CLIENT_ID_PATTERN = /^corvo-mcp(-[A-Za-z0-9_-]{8,40})?$/;

export function isMcpClientId(clientId: string): boolean {
  return MCP_CLIENT_ID_PATTERN.test(clientId);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'about:',
  'blob:',
  'ftp:',
]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/**
 * Redirect URIs accepted at registration: https, loopback http (any port,
 * RFC 8252 §7.3) or a private-use scheme such as `cursor://...` (§7.1).
 * Fragments and embedded credentials are never allowed.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  if (uri.length > 500) return false;
  const url = parse(uri);
  if (!url || url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return !FORBIDDEN_SCHEMES.has(url.protocol) && url.protocol.length > 2;
}

/**
 * Exact match against a registered URI, except loopback redirects where the
 * port may differ (the client picks a free port per login).
 */
export function matchesRegisteredRedirectUri(
  registered: readonly string[],
  requested: string,
): boolean {
  if (registered.includes(requested)) return true;
  const target = parse(requested);
  if (!target || target.protocol !== 'http:') return false;
  if (!LOOPBACK_HOSTS.has(target.hostname)) return false;
  return registered.some((candidate) => {
    const url = parse(candidate);
    return (
      url !== null &&
      url.protocol === 'http:' &&
      url.hostname === target.hostname &&
      url.pathname === target.pathname &&
      url.search === target.search
    );
  });
}

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'nfse:read': 'Consultar empresas, notas, cálculo fiscal e cotas',
  'nfse:write': 'Criar empresas, emitir e cancelar notas fiscais',
};

/** Keeps only known scopes, preserving order and removing duplicates. */
export function parseScopes(scope: string): string[] {
  const known = new Set<string>(MCP_SCOPES);
  return [...new Set(scope.split(/\s+/).filter((name) => known.has(name)))];
}
