import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_PLATFORM_ADMIN_PERMISSION,
  REQUIRED_TENANT_PERMISSION,
  RequiredTenantPermission,
} from './require-permission.decorator';
import { PUBLIC_ROUTE_KEY } from './application/public-route.decorator';
import type { RequestWithAuthContext } from './auth-context';
import { RoutePermissionService } from './application/route-permission.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly routePermissionService: RoutePermissionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    const authContext = request.authContext;
    if (!authContext) {
      throw new UnauthorizedException('Authenticated context is required');
    }

    const permission =
      this.reflector.getAllAndOverride<RequiredTenantPermission>(
        REQUIRED_TENANT_PERMISSION,
        [context.getHandler(), context.getClass()],
      );
    if (!permission) {
      return true;
    }

    const allowPlatformAdmin = Boolean(
      this.reflector.getAllAndOverride<boolean>(
        ALLOW_PLATFORM_ADMIN_PERMISSION,
        [context.getHandler(), context.getClass()],
      ),
    );

    const permissions = Array.isArray(permission) ? permission : [permission];
    if (
      !permissions.some((item) =>
        this.routePermissionService.hasPermission(authContext, item, {
          allowPlatformAdmin,
        }),
      )
    ) {
      throw new ForbiddenException(
        `One of these permissions is required: ${permissions
          .map((item) => `"${item}"`)
          .join(', ')}`,
      );
    }
    return true;
  }
}
