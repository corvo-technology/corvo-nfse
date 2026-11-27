import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRedisModule } from '@/infra/redis/redis.module';
import { TenantOrmEntity } from '@/infra/persistence/typeorm/entities/tenant.orm-entity';
import { FiscalDocumentRegistry } from './application/fiscal-document.registry';
import { InvoiceTypeRouter } from './application/invoice-type.router';
import { TypeormInvoiceSummaries } from './infra/typeorm-invoice-summaries';
import { NfeAccessPolicy } from './application/nfe-access.policy';
import { NfeEmissionPreconditions } from './application/nfe-emission-preconditions';
import { NFE_ENABLED_AUTHORITIES } from './domain/nfe-enabled-authorities';
import { NFE_RELEASE_READER } from './domain/nfe-release.reader';
import { NfeEnabledGuard } from './http/nfe-enabled.guard';
import { NfeEnabledAuthorityOrmEntity } from './infra/nfe-enabled-authority.orm-entity';
import { TypeormNfeEnabledAuthorities } from './infra/typeorm-nfe-enabled-authorities';
import { TypeormNfeReleaseReader } from './infra/typeorm-nfe-release.reader';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([TenantOrmEntity, NfeEnabledAuthorityOrmEntity]),
    AppRedisModule,
  ],
  providers: [
    FiscalDocumentRegistry,
    InvoiceTypeRouter,
    TypeormInvoiceSummaries,
    NfeAccessPolicy,
    NfeEmissionPreconditions,
    NfeEnabledGuard,
    { provide: NFE_RELEASE_READER, useClass: TypeormNfeReleaseReader },
    {
      provide: NFE_ENABLED_AUTHORITIES,
      useClass: TypeormNfeEnabledAuthorities,
    },
  ],
  exports: [
    FiscalDocumentRegistry,
    InvoiceTypeRouter,
    NfeAccessPolicy,
    NfeEmissionPreconditions,
    NfeEnabledGuard,
    NFE_ENABLED_AUTHORITIES,
  ],
})
export class FiscalCoreModule {}
