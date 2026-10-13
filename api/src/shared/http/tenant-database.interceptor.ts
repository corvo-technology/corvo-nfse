import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthContext } from '@/modules/auth/auth-context';
import { runWithTenant } from '@/infra/persistence/typeorm/tenant-context.storage';

@Injectable()
export class TenantDatabaseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ authContext?: AuthContext }>();
    const tenantId = request.authContext?.activeTenantId;
    if (!tenantId) return next.handle();
    return new Observable((subscriber) =>
      runWithTenant(tenantId, () => next.handle().subscribe(subscriber)),
    );
  }
}
