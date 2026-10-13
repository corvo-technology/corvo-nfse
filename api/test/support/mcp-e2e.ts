import { createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { McpAuthService } from '@/modules/mcp/mcp-auth.service';

/** Redirect URI used by the MCP e2e specs (must be registered on the client). */
export const MCP_REDIRECT_URI = 'http://localhost:9999/callback';
export const MCP_CLIENT_ID = 'corvo-mcp';
export const MCP_SCOPE_FULL = 'nfse:read nfse:write';

/** RFC 7636 PKCE S256 pair. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Decode a JWT payload without verifying the signature. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1] ?? '';
  const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/** Pull a single cookie value out of a `set-cookie` response header array. */
export function extractSetCookie(
  setCookie: string[] | string | undefined,
  name: string,
): string | undefined {
  const entries = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  for (const raw of entries) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim();
  }
  return undefined;
}

export interface MintedToken {
  accessToken: string;
  refreshToken: string;
  scope: string;
  connectionId: string;
}

/**
 * Mint a real access+refresh token pair by driving the actual
 * `McpAuthService` (authorization code + PKCE exchange) against the database.
 * Used by the tools spec so it does not have to repeat the browser flow.
 */
export async function mintToken(
  app: INestApplication,
  params: { authUserId: string; tenantId: string; scopes: string },
): Promise<MintedToken> {
  const mcpAuth = app.get(McpAuthService);
  const { verifier, challenge } = pkcePair();
  const code = await mcpAuth.createAuthorizationCode({
    clientId: MCP_CLIENT_ID,
    userId: params.authUserId,
    tenantId: params.tenantId,
    redirectUri: MCP_REDIRECT_URI,
    scope: params.scopes,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });
  const tokens = await mcpAuth.exchangeCode({
    code,
    codeVerifier: verifier,
    clientId: MCP_CLIENT_ID,
    redirectUri: MCP_REDIRECT_URI,
  });
  const payload = decodeJwtPayload(tokens.accessToken);
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
    connectionId: String(payload.connection_id),
  };
}

/** Build a JSON-RPC request body for `POST /v1/mcp`. */
export function mcpRpc(
  id: number | string,
  method: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  return params
    ? { jsonrpc: '2.0', id, method, params }
    : { jsonrpc: '2.0', id, method };
}
