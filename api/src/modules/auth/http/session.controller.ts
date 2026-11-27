import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponses } from '@/infra/openapi/swagger';
import { data } from '@/shared/http/response';
import { AuthContextService } from '../application/auth-context.service';
import { AuthUserService } from '../application/auth-user.service';

import { CookiePolicyService } from '../application/cookie-policy.service';
import { extractCookie } from '../application/cookie-reader';
import { CookieSessionService } from '../application/cookie-session.service';
import { CsrfGuard } from '../application/csrf.guard';
import { SwitchTenantDto } from '../application/auth.dto';
import { NfeEmissionPreconditions } from '@/modules/fiscal-core/application/nfe-emission-preconditions';
import { PlatformAdminPolicy } from '../application/platform-admin.policy';
import type { AuthSession } from '../domain/auth-session';

type HttpRequest = Request & {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  authContext?: { sessionId?: string };
  authSession?: AuthSession;
};

@Controller('auth/session')
@ApiTags('Auth')
@ApiErrorResponses()
export class SessionController {
  constructor(
    private readonly sessions: CookieSessionService,
    private readonly contexts: AuthContextService,
    private readonly cookies: CookiePolicyService,
    private readonly users: AuthUserService,
    private readonly platformAdmin: PlatformAdminPolicy,
    private readonly nfe: NfeEmissionPreconditions,
  ) {}

  /**
   * What the app needs to know about the product, nothing about the tenant: whether NF-e and NFC-e
   * can be issued in production (the one release switch left, `NFE_PRODUCTION_ENABLED`).
   */
  private features() {
    return { nfeProduction: this.nfe.productionEnabled() };
  }

  /** Who is signed in, so the app can greet them and ask for a name when there is none. */
  private async profile(authUserId: string) {
    const user = await this.users.findById(authUserId);
    return { name: user?.name ?? '', email: user?.email ?? '' };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async getSession(@Req() req: HttpRequest) {
    const session = await requireSession(req, this.cookies, this.sessions);
    const context = await this.contexts.buildForAuthUser(
      session.authUserId,
      'corvo',
      session.activeTenantId ?? undefined,
    );
    return data({
      status: 'authenticated' as const,
      isPlatformAdmin: (await this.platformAdmin.resolve(session.authUserId))
        .isAdmin,
      context,
      profile: await this.profile(session.authUserId),
      activeTenantId: session.activeTenantId,
      availableTenants: context.availableTenants,
      permissions: context.permissions,
      features: this.features(),
      expiresAt: session.expiresAt.toISOString(),
      csrfToken: this.sessions.generateCsrfToken(session.id),
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  async logout(
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await requireSession(req, this.cookies, this.sessions);
    await this.sessions.revokeSession(session.id);
    this.cookies.clear(res, 'session');
  }

  @Post('tenant')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  async switchTenant(@Req() req: HttpRequest, @Body() body: SwitchTenantDto) {
    const session = await requireSession(req, this.cookies, this.sessions);
    const context = await this.contexts.buildForAuthUser(
      session.authUserId,
      'corvo',
      body.tenantId,
    );
    const updated = await this.sessions.switchTenant(session, body.tenantId);
    return data({
      isPlatformAdmin: (await this.platformAdmin.resolve(session.authUserId))
        .isAdmin,
      context,
      profile: await this.profile(session.authUserId),
      activeTenantId: updated.activeTenantId,
      availableTenants: context.availableTenants,
      permissions: context.permissions,
      features: this.features(),
      expiresAt: updated.expiresAt.toISOString(),
      csrfToken: this.sessions.generateCsrfToken(updated.id),
    });
  }
}

async function requireSession(
  req: HttpRequest,
  cookies: CookiePolicyService,
  sessions: CookieSessionService,
) {
  if (req.authSession) return req.authSession;
  const value = extractCookie(req, cookies.name('session'));
  if (!value)
    throw new UnauthorizedException({
      code: 'SESSION_REQUIRED',
      message: 'Session cookie is required',
    });
  const session = await sessions.validateSession(value);
  if (!session)
    throw new UnauthorizedException({
      code: 'SESSION_EXPIRED',
      message: 'Invalid or expired session',
    });
  return session;
}
