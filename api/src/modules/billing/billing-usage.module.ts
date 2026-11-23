import { BillingRepository } from './domain/billing.repository';
import { TypeOrmBillingRepository } from './infra/typeorm-billing.repository';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingUsageService } from './application/billing-usage.service';
import { NoopBillingUsageService } from './application/noop-billing-usage.service';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { BillingUsagePeriod } from './infra/billing.orm-entity';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { TenantBillingOrmEntity } from '@/infra/persistence/typeorm/entities/tenant-billing.orm-entity';
import { PlanOrmEntity } from '@/modules/plans/infra/plan.orm-entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingUsagePeriod,
      TenantOrmEntity,
      TenantBillingOrmEntity,
      PlanOrmEntity,
    ]),
  ],
  providers: [
    IS_SELF_HOSTED
      ? { provide: BillingUsageService, useClass: NoopBillingUsageService }
      : BillingUsageService,
    { provide: BillingRepository, useClass: TypeOrmBillingRepository },
  ],
  exports: [BillingUsageService, BillingRepository],
})
export class BillingUsageModule {}
