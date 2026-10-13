import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { CreditTransactionOrmEntity } from './infra/credit-transaction.orm-entity';
import { TypeOrmCreditTransactionRepository } from './infra/typeorm-credit-transaction.repository';
import { ICreditTransactionRepository } from './domain/credit-transaction.repository';
import { CreditsService } from './application/credits.service';
import { CreditsController } from './http/credits.controller';
import { PlansModule } from '@/modules/plans/plans.module';

@Module({
  imports: [
    BillingUsageModule,
    TypeOrmModule.forFeature([CreditTransactionOrmEntity]),
    AppRedisModule,
    forwardRef(() => PlansModule),
  ],
  controllers: [CreditsController],
  providers: [
    {
      provide: ICreditTransactionRepository,
      useClass: TypeOrmCreditTransactionRepository,
    },
    CreditsService,
  ],
  exports: [CreditsService],
})
export class CreditsModule {}
