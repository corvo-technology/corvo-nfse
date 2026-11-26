import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import type { TenantPermission } from '../auth/domain/permission';

/** The pre-registered first-party OAuth client. */
export const MCP_CLIENT_ID = 'corvo-mcp';
/** Clients created through dynamic registration (RFC 7591) get this prefix. */
export const MCP_DYNAMIC_CLIENT_PREFIX = 'corvo-mcp-';
export const MCP_SCOPES = ['nfse:read', 'nfse:write'] as const;
/** Extra scopes the person ticks (unchecked) on the consent screen. */
export const MCP_OPTIONAL_SCOPES = [
  'nfse:certificates',
  'billing:purchase',
] as const;
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
  'nfse:certificates': 'Enviar o certificado digital da empresa',
  'nfe:read': 'Consultar NF-e e configurações de NF-e da empresa',
  'nfe:write': 'Emitir NF-e',
  'nfe:manage': 'Cancelar, corrigir e inutilizar NF-e',
  'billing:purchase':
    'Gerar cobranças de créditos (Pix ou cartão). O pagamento é sempre feito por você.',
};

/** Member permission needed to hold each scope. */
export const SCOPE_PERMISSION: Record<string, TenantPermission> = {
  'nfse:read': 'nfse.invoices.view',
  'nfse:write': 'nfse.invoices.issue',
  'nfse:certificates': 'nfse.certificates.manage',
  'nfe:read': 'nfe.documents.view',
  'nfe:write': 'nfe.documents.issue',
  'nfe:manage': 'nfe.documents.manage',
  'billing:purchase': 'billing.manage',
};

/** Optional scopes this deployment offers (no purchases when self-hosted). */
export function offeredOptionalScopes(
  selfHosted: boolean = IS_SELF_HOSTED,
): string[] {
  return MCP_OPTIONAL_SCOPES.filter(
    (scope) => !(selfHosted && scope === 'billing:purchase'),
  );
}

export function supportedScopes(
  selfHosted: boolean = IS_SELF_HOSTED,
): string[] {
  return [...MCP_SCOPES, ...offeredOptionalScopes(selfHosted)];
}

export function missingScopeMessage(scope: string): string {
  return `Esta conexão não tem permissão para: ${SCOPE_DESCRIPTIONS[scope] ?? scope}. Peça para a pessoa conectar a Corvo de novo e marcar essa opção na tela Autorizar Corvo.`;
}

export function missingMemberPermissionMessage(
  permission: TenantPermission,
): string {
  return `Seu papel nesta conta não permite esta ação (${permission}). Peça a um administrador da conta.`;
}

/** Keeps only known scopes, preserving order and removing duplicates. */
export function parseScopes(scope: string): string[] {
  const known = new Set<string>([...MCP_SCOPES, ...MCP_OPTIONAL_SCOPES]);
  return [...new Set(scope.split(/\s+/).filter((name) => known.has(name)))];
}
