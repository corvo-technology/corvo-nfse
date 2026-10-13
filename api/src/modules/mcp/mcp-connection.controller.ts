import { ApiCursorResponse } from '@/infra/openapi/swagger';
import { ConnectionSessionGuard } from './connection-session.guard';
import {
  DeferRateLimit,
  HttpApiRateLimitGuard,
} from '@/shared/http/rate-limit.guard';
import { CursorQuery } from '@/shared/http/pagination';
import {
  Controller,
  Delete,
  Get,
  UseGuards,
  Query,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PublicRoute } from '../auth/application/public-route.decorator';
import { AuthContextService } from '../auth/application/auth-context.service';
import { CookieSessionService } from '../auth/application/cookie-session.service';
import { extractCookie } from '../auth/application/cookie-reader';
import type { AuthSession } from '../auth/domain/auth-session';
import { McpConnectionService } from './mcp-connection.service';

/**
 * JSON "connected apps" API for the dashboard: list the caller's MCP
 * connections and revoke one by id.
 *
 * The route is marked {@link PublicRoute} and authenticates with
 * ConnectionSessionGuard before applying the shared session rate limit — because the global TenantContextGuard requires an
 * active-tenant context that these plain browser requests do not carry.
 */
@PublicRoute()
@ApiTags('MCP')
@DeferRateLimit()
@UseGuards(ConnectionSessionGuard, HttpApiRateLimitGuard)
@Controller('mcp/connections')
export class McpConnectionController {
  constructor(
    private readonly connections: McpConnectionService,
    private readonly sessions: CookieSessionService,
    private readonly contexts: AuthContextService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiCursorResponse()
  async list(@Req() req: Request, @Query() options: CursorQuery) {
    const session = await this.requireSession(req);
    const auth = await this.contexts.buildForAuthUser(
      session.authUserId,
      'corvo',
      session.activeTenantId ?? undefined,
    );
    return this.connections.listPage(
      session.authUserId,
      auth.activeTenantId,
      options,
    );
  }

  @Delete(':id')
  async revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const session = await this.requireSession(req);
    const auth = await this.contexts.buildForAuthUser(
      session.authUserId,
      'corvo',
      session.activeTenantId ?? undefined,
    );
    await this.connections.revoke(id, session.authUserId, auth);
    return { ok: true };
  }

  private async requireSession(req: Request): Promise<AuthSession> {
    const validated = (req as Request & { authSession?: AuthSession })
      .authSession;
    if (validated) return validated;
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
    return session;
  }
}
