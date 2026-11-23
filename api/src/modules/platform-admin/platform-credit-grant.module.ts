import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { CreditsModule } from '@/modules/credits/credits.module';
import { ApplicationEventsModule } from '@/shared/events/application-events.module';
import { IS_SELF_HOSTED } from '@/shared/deployment-mode';
import { PlatformCreditGrantService } from './application/platform-credit-grant.service';
import { PlatformCreditGrantController } from './http/platform-credit-grant.controller';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [
    PlatformAdminCoreModule,
    CreditsModule,
    ApplicationEventsModule,
    AuthModule,
  ],
  // Self-hosted has no credit ledger to grant on: the route does not exist (404).
  controllers: IS_SELF_HOSTED ? [] : [PlatformCreditGrantController],
  providers: [PlatformCreditGrantService],
})
export class PlatformCreditGrantModule {}
