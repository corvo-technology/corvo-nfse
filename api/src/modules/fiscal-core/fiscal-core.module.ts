import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { FiscalDocumentRegistry } from './application/fiscal-document.registry';
import { NfeAccessPolicy } from './application/nfe-access.policy';
import { NFE_RELEASE_READER } from './domain/nfe-release.reader';
import { NfeEnabledGuard } from './http/nfe-enabled.guard';
import { TypeormNfeReleaseReader } from './infra/typeorm-nfe-release.reader';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantOrmEntity]), AppRedisModule],
  providers: [
    FiscalDocumentRegistry,
    NfeAccessPolicy,
    NfeEnabledGuard,
    { provide: NFE_RELEASE_READER, useClass: TypeormNfeReleaseReader },
  ],
  exports: [FiscalDocumentRegistry, NfeAccessPolicy, NfeEnabledGuard],
})
export class FiscalCoreModule {}
