import { Module } from '@nestjs/common';
import { PlatformAuditController } from './http/platform-audit.controller';
import { PlatformAdminCoreModule } from './platform-admin-core.module';

@Module({
  imports: [PlatformAdminCoreModule],
  controllers: [PlatformAuditController],
})
export class PlatformAuditModule {}
