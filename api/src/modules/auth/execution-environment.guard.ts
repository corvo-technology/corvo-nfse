import {
  BadRequestException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthContext } from './auth-context';
import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

export function executionEnvironment(
  context: AuthContext,
): ExecutionEnvironment {
  return context.apiKeyEnvironment ?? context.executionEnvironment ?? 'test';
}

/** Runs after the global authentication guards, only on fiscal resources. */
@Injectable()
export class ExecutionEnvironmentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      authContext: AuthContext;
      body?: Record<string, unknown>;
    }>();
    const keyEnvironment = request.authContext.apiKeyEnvironment;
    const selected = keyEnvironment
      ? undefined
      : request.headers['x-corvo-environment'];
    if (selected !== undefined && selected !== 'test' && selected !== 'live') {
      throw new BadRequestException('X-Corvo-Environment must be test or live');
    }
    if (request.body && Object.hasOwn(request.body, 'environment')) {
      throw new BadRequestException(
        'Select the environment through authentication or X-Corvo-Environment',
      );
    }
    request.authContext.executionEnvironment =
      keyEnvironment ?? selected ?? 'test';
    return true;
  }
}
