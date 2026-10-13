import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthContextService } from './auth-context.service';
import { CookieSessionService } from './cookie-session.service';
import { CookiePolicyService } from './cookie-policy.service';
import { extractCookie } from './cookie-reader';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE_KEY } from './public-route.decorator';
import type { AuthSession } from '../domain/auth-session';

type HttpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  authContext?: unknown;
  authMode?: 'api_key' | 'bearer' | 'cookie';
  authSession?: AuthSession;
};

@Injectable()
export class CookieAuthGuard implements CanActivate {
  constructor(
    private readonly cookieSessionService: CookieSessionService,
    private readonly authContextService: AuthContextService,
    private readonly cookies: CookiePolicyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (request.authContext && request.authMode === 'api_key') return true;

    const cookieValue = extractCookie(request, this.cookies.name('session'));
    if (!cookieValue) {
      throw new UnauthorizedException('Session cookie is required');
    }

    const session =
      await this.cookieSessionService.validateSession(cookieValue);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.authContext = {
      ...(await this.authContextService.buildForAuthUser(
        session.authUserId,
        'corvo',
        session.activeTenantId ?? undefined,
      )),
      sessionId: session.id,
    };
    request.authSession = session;
    request.authMode = 'cookie';
    return true;
  }
}
