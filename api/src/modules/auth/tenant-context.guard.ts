import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE_KEY } from './application/public-route.decorator';
import type { RequestWithAuthContext } from './auth-context';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      typeof context.getHandler === 'function' &&
      typeof context.getClass === 'function' &&
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    const authContext = request.authContext;

    if (authContext === undefined) {
      throw new UnauthorizedException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Authenticated context is required',
      });
    }

    if (!isUuid(authContext.activeTenantId)) {
      throw new UnauthorizedException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'An active tenant context is required',
      });
    }

    const routeTenantId = request.params?.tenantId;
    if (routeTenantId !== undefined && isPlatformRoute(request)) {
      return true;
    }

    if (routeTenantId !== undefined && !isUuid(routeTenantId)) {
      throw new BadRequestException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Invalid tenantId',
      });
    }

    if (
      routeTenantId !== undefined &&
      routeTenantId !== authContext.activeTenantId
    ) {
      throw new ForbiddenException({
        code: 'TENANT_ACCESS_DENIED',
        message: 'Tenant access denied',
      });
    }

    return true;
  }
}

function isPlatformRoute(request: RequestWithAuthContext): boolean {
  const path =
    'originalUrl' in request
      ? request.originalUrl
      : 'url' in request
        ? request.url
        : undefined;
  return typeof path === 'string' && /^\/v\d+\/platform(?:\/|$)/.test(path);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
