import { McpConnectionService } from './mcp-connection.service';
import { AuthContextService } from '../auth/application/auth-context.service';
import { RawResponse } from '@/shared/http/response.interceptor';
import {
  Controller,
  Inject,
  Get,
  NotFoundException,
  Post,
  Param,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { CookieSessionService } from '../auth/application/cookie-session.service';
import { extractCookie } from '../auth/application/cookie-reader';
import {
  MCP_CONNECTION_REPOSITORY,
  type McpConnectionRepository,
} from './domain/mcp-connection.repository';

type DashboardConnection = {
  id: string;
  clientId: string;
  tenantId: string;
  scopes: string[];
  grantedAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/**
 * Server-rendered "Connected Apps" page. Uses the same session-cookie
 * validation pattern as McpConsentController (global guards do not build an
 * auth context for plain browser HTML routes).
 */
@PublicRoute()
@ApiTags('MCP')
@Controller('mcp')
@RawResponse()
export class McpDashboardController {
  constructor(
    private readonly connectionManager: McpConnectionService,
    private readonly contexts: AuthContextService,
    private readonly sessions: CookieSessionService,
    @Inject(MCP_CONNECTION_REPOSITORY)
    private readonly connections: McpConnectionRepository,
  ) {}

  @Get('dashboard')
  async dashboard(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { authUserId, activeTenantId } = await this.requireContext(req);
    const rows = await this.connections.findAllByUserAndTenant(
      authUserId,
      activeTenantId,
    );

    res.status(200).type('text/html');
    return renderDashboard(rows);
  }

  @Post('dashboard/revoke/:id')
  async revoke(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const auth = await this.requireContext(req);
    const { authUserId, activeTenantId } = auth;
    const connection = await this.connections.findByIdAndOwner(
      id,
      activeTenantId,
      authUserId,
    );
    if (!connection || connection.authUserId !== authUserId) {
      throw new NotFoundException('Connection not found');
    }
    await this.connectionManager.revoke(id, authUserId, auth);
    res.redirect(302, '/mcp/dashboard');
  }

  private async requireContext(
    req: Request,
  ): Promise<import('../auth/auth-context').AuthContext> {
    const token =
      extractCookie(req, 'corvo_session') ??
      extractCookie(req, 'gf_session_dev') ??
      extractCookie(req, '__Host-gf_session');
    if (!token) {
      throw new UnauthorizedException('Session cookie is required');
    }
    const session = await this.sessions.validateSession(token);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    return this.contexts.buildForAuthUser(
      session.authUserId,
      'corvo',
      session.activeTenantId ?? undefined,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return value.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function renderDashboard(connections: DashboardConnection[]): string {
  const rows =
    connections.length === 0
      ? `<tr><td colspan="5" class="empty">Nenhum aplicativo conectado.</td></tr>`
      : connections
          .map((connection) => {
            const revoked = connection.revokedAt !== null;
            const status = revoked
              ? '<span class="badge revoked">Revogado</span>'
              : '<span class="badge active">Ativo</span>';
            const action = revoked
              ? ''
              : `<form method="post" action="/mcp/dashboard/revoke/${encodeURIComponent(connection.id)}">
                   <button type="submit" class="revoke">Revogar</button>
                 </form>`;
            return `<tr>
              <td>${escapeHtml(connection.clientId)}<br />${status}</td>
              <td><code>${escapeHtml(connection.tenantId)}</code></td>
              <td>${connection.scopes.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ')}</td>
              <td>${formatDate(connection.grantedAt)}<br />último uso: ${formatDate(connection.lastUsedAt)}</td>
              <td>${action}</td>
            </tr>`;
          })
          .join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aplicativos conectados — Corvo</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid #e5e5e5; font-size: 0.9rem; vertical-align: top; }
    th { font-weight: 600; color: #555; }
    .empty { text-align: center; color: #777; padding: 2rem; }
    .badge { font-size: 0.75rem; padding: 0.1rem 0.45rem; border-radius: 999px; }
    .badge.active { background: #e6f6ec; color: #14713d; }
    .badge.revoked { background: #fdecec; color: #a02020; }
    .revoke { background: #fff; color: #a02020; border: 1px solid #a02020; border-radius: 6px; padding: 0.35rem 0.8rem; cursor: pointer; font-size: 0.85rem; }
    .revoke:hover { background: #a02020; color: #fff; }
    code { background: #f4f4f4; padding: 0.05rem 0.3rem; border-radius: 4px; font-size: 0.82em; }
  </style>
</head>
<body>
  <h1>Aplicativos conectados</h1>
  <p>Aplicativos com acesso autorizado à sua conta via MCP OAuth.</p>
  <table>
    <thead>
      <tr><th>Aplicativo</th><th>Tenant</th><th>Escopos</th><th>Concedido em</th><th></th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}
