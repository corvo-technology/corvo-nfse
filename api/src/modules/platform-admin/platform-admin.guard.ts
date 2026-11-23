import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RequestWithAuthContext } from '@/modules/auth/auth-context';
import { PlatformAdminPolicy } from '@/modules/auth/application/platform-admin.policy';
import { PlatformAdminOnly } from '@/modules/auth/platform-admin-only.decorator';
import { resolveClientIp } from '@/shared/http/client-ip';
import { hashIp } from './infra/platform-admin-audit.repository';

export type PlatformAdminActor = {
  authUserId: string;
  email: string;
  ipHash: string | null;
};

export type RequestWithPlatformAdmin = RequestWithAuthContext & {
  platformAdmin?: PlatformAdminActor;
  authMode?: 'api_key' | 'bearer' | 'cookie';
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  method?: string;
  path?: string;
};

function notFound(): NotFoundException {
  return new NotFoundException({
    code: 'RESOURCE_NOT_FOUND',
    message: 'Resource not found',
  });
}

/**
 * Security gate of the platform admin. Only a cookie session of a verified
 * e-mail listed in PLATFORM_ADMIN_EMAILS passes; everyone else (member,
 * API key, MCP) gets 404. The policy is asked on every request.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);

  constructor(private readonly policy: PlatformAdminPolicy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithPlatformAdmin>();
    const auth = request.authContext;
    const route = `${request.method ?? '?'} ${request.path ?? '?'}`;

    if (
      !auth ||
      request.authMode !== 'cookie' ||
      auth.principalType !== 'tenant_member' ||
      auth.mcpConnectionId ||
      !auth.authUserId
    ) {
      this.logger.warn(
        `Platform admin route refused (ineligible principal) for user ${auth?.authUserId ?? 'anonymous'} (authMode ${request.authMode ?? 'none'}): ${route}`,
      );
      throw notFound();
    }

    const { isAdmin, email } = await this.policy.resolve(auth.authUserId);
    if (!isAdmin || !email) {
      this.logger.warn(
        `Platform admin route refused for user ${auth.authUserId}: ${route}`,
      );
      throw notFound();
    }

    request.platformAdmin = {
      authUserId: auth.authUserId,
      email,
      ipHash: hashIp(resolveClientIp(request)),
    };
    return true;
  }
}

export function PlatformAdminRoute(): ClassDecorator {
  return applyDecorators(
    PlatformAdminOnly(),
    UseGuards(PlatformAdminGuard),
    ApiExcludeController(),
  );
}
