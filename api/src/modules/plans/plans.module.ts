import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmPlanRepository } from './infra/typeorm-plan.repository';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { PlanOrmEntity } from './infra/plan.orm-entity';
import { IPlanRepository } from './domain/plan.repository';
import { PricingService } from './application/pricing.service';
import { PlanSeederService } from './application/plan-seeder.service';
import { TypeOrmTenantPlanRepository } from './infra/typeorm-tenant-plan.repository';
import { TENANT_PLAN_REPOSITORY } from './domain/tenant-plan-assignment';
import { TenantPlanService } from './application/tenant-plan.service';
import { QuotaService } from './application/quota.service';
import { UnlimitedQuotaService } from './application/unlimited-quota.service';
import { SelfHostedPlanAssigner } from './application/self-hosted-plan-assigner.service';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { FreeAbuseChecker } from './application/free-abuse-checker.service';
import { CompanyOrmEntity } from '@/modules/company/infra/company.orm-entity';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { TypeOrmCompanyRepository } from '@/modules/company/infra/typeorm-company.repository';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { RedisRateLimiter } from '@/shared/http/redis-rate-limiter';
import { CreditsModule } from '@/modules/credits/credits.module';
import { SecurityModule } from '@/modules/security/security.module';

@Module({
  imports: [
    BillingUsageModule,
    TypeOrmModule.forFeature([
      CompanyOrmEntity,
      PlanOrmEntity,
      TenantOrmEntity,
      TenantBillingOrmEntity,
    ]),
    AppRedisModule,
    forwardRef(() => CreditsModule),
    SecurityModule,
  ],
  providers: [
    { provide: ICompanyRepository, useClass: TypeOrmCompanyRepository },
    {
      provide: IPlanRepository,
      useClass: TypeOrmPlanRepository,
    },
    {
      provide: TENANT_PLAN_REPOSITORY,
      useClass: TypeOrmTenantPlanRepository,
    },
    PricingService,
    PlanSeederService,
    TenantPlanService,
    // self_hosted swaps the implementation behind the same token; cloud is unchanged.
    IS_SELF_HOSTED
      ? { provide: QuotaService, useClass: UnlimitedQuotaService }
      : QuotaService,
    RedisRateLimiter,
    ...(IS_SELF_HOSTED ? [SelfHostedPlanAssigner] : [FreeAbuseChecker]),
  ],
  exports: [
    IPlanRepository,
    TENANT_PLAN_REPOSITORY,
    PricingService,
    TenantPlanService,
    QuotaService,
    ...(IS_SELF_HOSTED ? [] : [FreeAbuseChecker]),
  ],
})
export class PlansModule {}
