import { Module } from '@nestjs/common';
import { PlatformAttentionModule } from './platform-attention.module';
import { PlatformAuditModule } from './platform-audit.module';
import { PlatformContingencyModule } from './platform-contingency.module';
import { PlatformCreditGrantModule } from './platform-credit-grant.module';
import { PlatformNfeAccessModule } from './platform-nfe-access.module';
import { PlatformOverviewModule } from './platform-overview.module';
import { PlatformUserDetailModule } from './platform-user-detail.module';
import { PlatformUsersModule } from './platform-users.module';

/** Platform owner area (`/v1/platform/*`). API only: the worker never loads it. */
@Module({
  imports: [
    PlatformOverviewModule,
    PlatformUsersModule,
    PlatformUserDetailModule,
    PlatformAttentionModule,
    PlatformAuditModule,
    PlatformCreditGrantModule,
    PlatformNfeAccessModule,
    PlatformContingencyModule,
  ],
})
export class PlatformAdminModule {}
