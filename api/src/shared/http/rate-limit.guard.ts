import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisRateLimiter } from './redis-rate-limiter';
import { resolveClientIp } from './client-ip';
import type { AuthContext } from '@/modules/auth/auth-context';

export const DEFER_RATE_LIMIT = 'http:defer-rate-limit';
export const DeferRateLimit = () => SetMetadata(DEFER_RATE_LIMIT, true);
type RateRequest = Request & {
  authContext?: AuthContext;
  authSession?: { id: string };
  validatedApiKeyId?: string;
  deferredRateLimitReady?: boolean;
};
function exempt(request: Request): boolean {
  return (
    request.method === 'OPTIONS' ||
    /\/(health\/(live|ready)|webhooks\/stripe)$/.test(request.path)
  );
}
@Injectable()
export class HttpApiRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RedisRateLimiter,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateRequest>();
    if (exempt(request)) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(DEFER_RATE_LIMIT, targets) &&
      !request.deferredRateLimitReady
    )
      return true;
    const sessionId = request.authContext?.sessionId ?? request.authSession?.id;
    const identity = request.validatedApiKeyId
      ? `key:${request.validatedApiKeyId}`
      : sessionId
        ? `session:${sessionId}`
        : `ip:${resolveClientIp(request) ?? 'unknown'}`;
    const authenticated = Boolean(request.validatedApiKeyId || sessionId);
    const max =
      this.config.get<number>(
        authenticated ? 'RATE_LIMIT_AUTHENTICATED' : 'RATE_LIMIT_PUBLIC',
      ) ?? (authenticated ? 300 : 120);
    await this.enforce(
      context,
      `${authenticated ? 'authenticated' : 'public'}:${identity}`,
      max,
      60000,
    );
    const routeMax = this.reflector.getAllAndOverride<number>(
      'THROTTLER:LIMITdefault',
      targets,
    );
    const routeTtl =
      this.reflector.getAllAndOverride<number>(
        'THROTTLER:TTLdefault',
        targets,
      ) ?? 60000;
    if (routeMax)
      await this.enforce(
        context,
        `sensitive:${context.getClass().name}:${context.getHandler().name}:ip:${resolveClientIp(request) ?? 'unknown'}`,
        routeMax,
        routeTtl,
      );
    return true;
  }
  private async enforce(
    context: ExecutionContext,
    key: string,
    max: number,
    windowMs: number,
  ) {
    const result = await this.limiter.check(key, { max, windowMs });
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('X-RateLimit-Limit', max);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
      );
      throw new HttpException(
        { code: 'ERROR_RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
        429,
      );
    }
  }
}
@Injectable()
export class PreAuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RedisRateLimiter,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (exempt(request)) return true;
    const max = this.config.get<number>('RATE_LIMIT_PRE_AUTH') ?? 1200;
    const result = await this.limiter.check(
      `pre-auth:ip:${resolveClientIp(request) ?? 'unknown'}`,
      { max, windowMs: 60000 },
    );
    if (!result.allowed) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('X-RateLimit-Limit', max);
      response.setHeader('X-RateLimit-Remaining', result.remaining);
      response.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
      response.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
      );
      throw new HttpException(
        { code: 'ERROR_RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' },
        429,
      );
    }
    return true;
  }
}
