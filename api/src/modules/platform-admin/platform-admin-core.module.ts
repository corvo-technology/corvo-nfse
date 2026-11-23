import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { PlatformAdminAuditRepository } from './infra/platform-admin-audit.repository';
import { PlatformReadSession } from './infra/platform-read-session';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [AuthModule],
  providers: [
    PlatformAdminGuard,
    PlatformReadSession,
    PlatformAdminAuditRepository,
  ],
  exports: [
    PlatformAdminGuard,
    PlatformReadSession,
    PlatformAdminAuditRepository,
    AuthModule,
  ],
})
export class PlatformAdminCoreModule {}
