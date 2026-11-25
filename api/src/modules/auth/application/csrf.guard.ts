/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-argument */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfService } from './csrf.service';
import { PUBLIC_ROUTE_KEY } from './public-route.decorator';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@/infra/config/configuration.types';
import { recordCsrfFailure } from '@/modules/security/observability/security.metrics';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly csrfService: CsrfService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.allowedOrigins = new Set(
      config
        .getOrThrow<AppConfig>('app')
        .corsOrigins.map((origin) => new URL(origin).origin),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<any>();

    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(String(request.method).toUpperCase())
    ) {
      return true;
    }

    // Machine-to-machine credentials do not rely on browser cookies.
    if (request.authMode === 'bearer' || request.authMode === 'api_key') {
      return true;
    }

    const origin = request.headers?.origin;
    if (typeof origin !== 'string' || !this.allowedOrigins.has(origin)) {
      recordCsrfFailure('origin');
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Invalid request origin',
      });
    }
    const fetchSite = request.headers?.['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
      recordCsrfFailure('fetch_metadata');
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Cross-site request denied',
      });
    }
    const contentType = String(request.headers?.['content-type'] ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();

    const emptyRequestWithoutContentType =
      contentType === '' &&
      (request.emptyBody === true || !requestHasBody(request.headers));
    if (
      !emptyRequestWithoutContentType &&
      contentType !== 'application/json' &&
      contentType !== 'multipart/form-data'
    ) {
      recordCsrfFailure('content_type');
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Unsupported content type',
      });
    }

    const csrfToken =
      request.headers?.['x-csrf-token'] ?? request.headers?.['X-CSRF-Token'];
    if (!csrfToken || typeof csrfToken !== 'string') {
      recordCsrfFailure('missing_token');
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'CSRF token required',
      });
    }

    const sessionId = request.authContext?.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      recordCsrfFailure('missing_session');
      throw new ForbiddenException({
        code: 'SESSION_REQUIRED',
        message: 'No active session',
      });
    }

    if (!this.csrfService.validateToken(sessionId, csrfToken)) {
      recordCsrfFailure('invalid_token');
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Invalid CSRF token',
      });
    }

    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }
}

function requestHasBody(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  const transferEncoding = firstHeader(headers?.['transfer-encoding']);
  if (transferEncoding) return true;

  const rawContentLength = firstHeader(headers?.['content-length']);
  if (rawContentLength === undefined) return false;
  const contentLength = Number(rawContentLength);
  return !Number.isFinite(contentLength) || contentLength > 0;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
