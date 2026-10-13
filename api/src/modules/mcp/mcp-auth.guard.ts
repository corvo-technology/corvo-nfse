import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthContext } from '../auth/auth-context';
import type { Request } from 'express';
import { McpAuthService } from './mcp-auth.service';

type McpTokenPayload = {
  sub: string;
  tenant_id: string;
  scopes: string[];
  session_id?: string;
};

@Injectable()
export class McpAuthGuard implements CanActivate {
  // Typed as McpAuthService so Nest's DI metadata resolves the concrete
  // token (`any` would emit `Object` and break constructor injection).
  constructor(private readonly authService: McpAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & {
        authContext?: AuthContext;
        deferredRateLimitReady?: boolean;
      }
    >();
    const header = req.headers['authorization'] ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Missing authorization header');

    const payload = await this.authService.validateAccessToken(token);
    req.authContext = buildMcpAuthContext(payload); // maps JWT payload → minimal AuthContext
    req.deferredRateLimitReady = true;
    return true;
  }
}

export function buildMcpAuthContext(payload: McpTokenPayload): AuthContext {
  return {
    authUserId: payload.sub,
    userId: payload.sub,
    productKey: 'corvo',
    tenantId: payload.tenant_id,
    activeTenantId: payload.tenant_id,
    role: 'admin',
    contextType: 'tenant',
    platformRole: null,
    platformPermissions: [],
    permissions: payload.scopes,
    scope: payload.scopes.join(' '),
    membershipId: undefined,
    isPlatformAdmin: false,
    sessionId: payload.session_id,
    clientId: 'corvo-mcp',
  };
}
