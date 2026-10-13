import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CookieSessionService } from '@/modules/auth/application/cookie-session.service';
import { CookiePolicyService } from '@/modules/auth/application/cookie-policy.service';
import { extractCookie } from '@/modules/auth/application/cookie-reader';
import type { AuthSession } from '@/modules/auth/domain/auth-session';
@Injectable()
export class ConnectionSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: CookieSessionService,
    private readonly cookies: CookiePolicyService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<
      Request & {
        authSession?: AuthSession;
        deferredRateLimitReady?: boolean;
      }
    >();
    const token = extractCookie(request, this.cookies.name('session'));
    if (!token) throw new UnauthorizedException('Session cookie is required');
    const session = await this.sessions.validateSession(token);
    if (!session) throw new UnauthorizedException('Invalid or expired session');
    request.authSession = session;
    request.deferredRateLimitReady = true;
    return true;
  }
}
