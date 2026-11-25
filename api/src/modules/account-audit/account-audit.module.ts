import { DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { SentryRuntime } from '@/infra/observability/sentry-reporter';
import { AccountAuditRecorder } from './domain/account-audit';
import {
  ACCOUNT_AUDIT_RUNTIME,
  AccountAuditService,
} from './application/account-audit.service';
import { AuditActorInterceptor } from './http/audit-actor.interceptor';
import {
  AuditActorLabeler,
  IAccountAuditRepository,
} from './domain/account-audit.repository';
import { TypeOrmAuditActorLabelResolver } from './infra/typeorm-audit-actor-label.resolver';
import { AccountAuditController } from './http/account-audit.controller';
import { TypeOrmAccountAuditRepository } from './infra/typeorm-account-audit.repository';

/**
 * Global audit trail. `forRoot('api')` also serves GET /v1/audit-events and
 * remembers the request actor; the worker only needs the recorder.
 */
@Global()
@Module({})
export class AccountAuditModule {
  static forRoot(runtime: Exclude<SentryRuntime, 'canary'>): DynamicModule {
    const providers: Provider[] = [
      { provide: ACCOUNT_AUDIT_RUNTIME, useValue: runtime },
      {
        provide: IAccountAuditRepository,
        useClass: TypeOrmAccountAuditRepository,
      },
      { provide: AuditActorLabeler, useClass: TypeOrmAuditActorLabelResolver },
      AccountAuditService,
      { provide: AccountAuditRecorder, useExisting: AccountAuditService },
      ...(runtime === 'api'
        ? [{ provide: APP_INTERCEPTOR, useClass: AuditActorInterceptor }]
        : []),
    ];
    return {
      module: AccountAuditModule,
      controllers: runtime === 'api' ? [AccountAuditController] : [],
      providers,
      exports: [AccountAuditRecorder, IAccountAuditRepository],
    };
  }
}
