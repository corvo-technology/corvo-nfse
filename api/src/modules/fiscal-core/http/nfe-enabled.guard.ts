import {
  applyDecorators,
  Injectable,
  NotFoundException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthContext } from '@/modules/auth/auth-context';
import { NfeAccessPolicy } from '../application/nfe-access.policy';

/** Answers 404 (as if the route did not exist) while NF-e is not released for the tenant. */
@Injectable()
export class NfeEnabledGuard implements CanActivate {
  constructor(private readonly policy: NfeAccessPolicy) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ authContext?: AuthContext }>();
    const tenantId = request.authContext?.tenantId;
    if (!tenantId || !(await this.policy.isEnabled(tenantId)))
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    return true;
  }
}

/** Put on a route that exists only for NF-e (the company NF-e settings). `/v1/invoices` checks the release in `InvoiceTypeRouter`. */
export const NfeRoute = () => applyDecorators(UseGuards(NfeEnabledGuard));
