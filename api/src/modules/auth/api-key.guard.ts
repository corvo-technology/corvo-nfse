/* eslint-disable @typescript-eslint/await-thenable */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthContextService } from './application/auth-context.service';
import { ApiKeyService } from './application/api-key.service';
import { PUBLIC_ROUTE_KEY } from './application/public-route.decorator';
import { API_KEY_ENDPOINT } from './api-key-endpoint.decorator';
import { PLATFORM_ADMIN_ONLY } from './platform-admin-only.decorator';

type HttpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  path?: string;
  method?: string;
  authContext?: unknown;
  authMode?: 'api_key' | 'bearer' | 'cookie';
  validatedApiKeyId?: string;
};

/**
 * Guard that authenticates requests via the `x-api-key` header.
 *
 * When the header is present the guard validates the key, builds a full
 * {@link AuthContext} for the owning tenant and attaches it to the request.
 * This allows downstream guards (TenantContextGuard, PermissionGuard, etc.)
 * to work unchanged.
 *
 * When the header is absent the guard delegates to the next guard in the
 * chain (i.e. JwtAuthGuard via the global APP_GUARD registration).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeyService: ApiKeyService,
    private readonly authContextService: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const rawKey = this.extractApiKey(request);
    if (!rawKey) {
      // No API key provided - fall through to the next guard (JwtAuthGuard).
      return true;
    }

    const apiKey = await this.apiKeyService.validate(rawKey);

    if (!this.isApiKeyEndpoint(context)) {
      // The platform admin does not exist for API keys: 404, never 403.
      if (this.isPlatformAdminOnly(context)) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
        });
      }
      throw new ForbiddenException({
        code: 'API_KEY_NOT_ALLOWED',
        message:
          'This endpoint is not available through API-key authentication',
      });
    }

    // The persisted key environment is authoritative for fiscal resources.

    // Build a full auth context for the tenant that owns this key.
    const authContext = await this.authContextService.buildForApiKey(
      apiKey.tenantId,
      apiKey.scope,
      apiKey.environment,
    );

    request.validatedApiKeyId = apiKey.id;
    request.authContext = authContext;
    request.authMode = 'api_key';

    // Fire-and-forget last-used update so we don't add latency to the request.
    this.apiKeyService
      .touchLastUsed(apiKey.id, apiKey.tenantId)
      .catch(() => {});

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

  private isApiKeyEndpoint(context: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(API_KEY_ENDPOINT, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }

  private isPlatformAdminOnly(context: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_ONLY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }

  private extractApiKey(request: HttpRequest): string | undefined {
    const value =
      request.headers?.['x-api-key'] ?? request.headers?.['X-API-Key'];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.trim() || undefined;
  }
}
