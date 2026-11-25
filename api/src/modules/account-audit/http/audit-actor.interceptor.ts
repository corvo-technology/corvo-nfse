import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import type { AuthContext } from '@/modules/auth/auth-context';
import type { OtpConfig } from '@/infra/config/configuration.types';
import { hashIp } from '@/modules/platform-admin/infra/platform-admin-audit.repository';
import {
  resolveClientIp,
  type HttpClientIpRequest,
} from '@/shared/http/client-ip';
import type { AuditActorRef } from '../domain/account-audit';
import { runWithAuditActor } from '../application/audit-actor.context';

type AuditedRequest = HttpClientIpRequest & {
  authContext?: AuthContext;
  validatedApiKeyId?: string;
};

/** Remembers who is acting for the length of the request, so services can audit without being told. */
@Injectable()
export class AuditActorInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const auth = request.authContext;
    if (!auth) return next.handle();
    const ipHash = hashIp(
      resolveClientIp(request),
      this.config.getOrThrow<OtpConfig>('otp').hmacSecret,
    );
    let actor: AuditActorRef;
    if (auth.mcpConnectionId)
      actor = {
        type: 'agent',
        id: auth.mcpConnectionId,
        onBehalfOfUserId: auth.authUserId,
        ipHash,
      };
    else if (auth.principalType === 'api_key')
      actor = {
        type: 'api_key',
        id: request.validatedApiKeyId ?? null,
        ipHash,
      };
    else actor = { type: 'user', id: auth.authUserId, ipHash };
    return new Observable((subscriber) =>
      runWithAuditActor(actor, () => next.handle().subscribe(subscriber)),
    );
  }
}
