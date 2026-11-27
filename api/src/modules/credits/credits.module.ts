import { BillingUsageModule } from '@/modules/billing/billing-usage.module';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { CreditTransactionOrmEntity } from './infra/credit-transaction.orm-entity';
import { TypeOrmCreditTransactionRepository } from './infra/typeorm-credit-transaction.repository';
import { ICreditTransactionRepository } from './domain/credit-transaction.repository';
import { CreditsService } from './application/credits.service';
import { CreditsController } from './http/credits.controller';
import { NoopCreditTransactionRepository } from './infra/noop-credit-transaction.repository';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { CREDIT_PRICE_READER } from '@/modules/fiscal-core/domain/credit-price';
import { DocumentCreditPriceOrmEntity } from './infra/document-credit-price.orm-entity';
import { TypeormCreditPriceReader } from './infra/typeorm-credit-price.reader';
import { PlansModule } from '@/modules/plans/plans.module';

@Module({
  imports: [
    BillingUsageModule,
    TypeOrmModule.forFeature([
      CreditTransactionOrmEntity,
      DocumentCreditPriceOrmEntity,
    ]),
    AppRedisModule,
    forwardRef(() => PlansModule),
  ],
  controllers: IS_SELF_HOSTED ? [] : [CreditsController],
  providers: [
    {
      provide: ICreditTransactionRepository,
      useClass: IS_SELF_HOSTED
        ? NoopCreditTransactionRepository
        : TypeOrmCreditTransactionRepository,
    },
    CreditsService,
    { provide: CREDIT_PRICE_READER, useClass: TypeormCreditPriceReader },
  ],
  exports: [CreditsService, ICreditTransactionRepository, CREDIT_PRICE_READER],
})
export class CreditsModule {}
