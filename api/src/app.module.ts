import { TenantDatabaseInterceptor } from '@/shared/http/tenant-database.interceptor';
import { PreAuthRateLimitGuard } from '@/shared/http/rate-limit.guard';
import { ResponseInterceptor } from '@/shared/http/response.interceptor';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppConfigModule } from '@/infra/config/config.module';
import { AppLoggingModule } from '@/infra/logging/logging.module';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { AppDatabaseModule } from '@/infra/database/database.module';
import { TypeOrmPersistenceModule } from '@/infra/persistence/typeorm/typeorm-persistence.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { WebhooksConfigModule } from '@/modules/webhooks-config/webhooks-config.module';
import { HealthModule } from '@/modules/health/health.module';
import { SecurityModule } from '@/modules/security/security.module';
import { PlansModule } from '@/modules/plans/plans.module';
import { PlanController } from '@/modules/plans/http/plan.controller';
import { BillingModule } from '@/modules/billing/billing.module';
import { CompanyModule } from '@/modules/company/company.module';
import { CertificateModule } from '@/modules/certificate/certificate.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { McpModule } from '@/modules/mcp/mcp.module';
import { StorageModule } from '@/infra/storage/storage.module';
import { NfseExternalModule } from '@/infra/external/nfse/nfse-external.module';
import { DomainExceptionFilter } from '@/shared/http/domain-exception.filter';
import { SentryModule } from '@/infra/observability/sentry.module';

@Module({
  imports: [
    SentryModule.forRoot('api'),

    AppConfigModule,
    AppLoggingModule,
    AppDatabaseModule,
    TypeOrmPersistenceModule,
    AppRedisModule,
    AuthModule,
    HealthModule,
    CreditsModule,
    WebhooksConfigModule,
    SecurityModule,
    PlansModule,
    BillingModule,
    CompanyModule,
    CertificateModule,
    InvoiceModule,
    McpModule,
    StorageModule.forRoot(),
    NfseExternalModule,
  ],
  controllers: [PlanController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: PreAuthRateLimitGuard,
    },
    { provide: APP_INTERCEPTOR, useClass: TenantDatabaseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
  ],
})
export class AppModule {}
