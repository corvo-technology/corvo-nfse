import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FakeNfeGateway } from '@/infra/external/nfe/sefaz/fake-nfe.gateway';
import { XmllintSchemaValidator } from '@/infra/external/nfe/sefaz/schema-validator';
import { CompanyModule } from '@/modules/company/company.module';
import { FiscalDocumentRegistry } from '@/modules/fiscal-core/application/fiscal-document.registry';
import { INfeDocumentRepository } from './domain/nfe-document.repository';
import { INfeNumberPreview } from './domain/nfe-number-preview';
import { NfeValidateService } from './application/nfe-validate.service';
import { NfeValidateController } from './http/nfe-validate.controller';
import { NfeDocumentHistoryOrmEntity } from './infra/nfe-document-history.orm-entity';
import { NfeDocumentItemOrmEntity } from './infra/nfe-document-item.orm-entity';
import { NfeDocumentOrmEntity } from './infra/nfe-document.orm-entity';
import { NfeNumberSequenceOrmEntity } from './infra/nfe-number-sequence.orm-entity';
import { TypeOrmNfeDocumentRepository } from './infra/typeorm-nfe-document.repository';
import { TypeormNfeNumbering } from './infra/typeorm-nfe-numbering';
import { NFE_SCHEMA_VALIDATOR } from './nfe.tokens';

/**
 * NF-e (model 55): documents, numbering and the dry-run. Emission, consultation and events arrive
 * in the next PRs; `FiscalDocumentRegistry` already gets the simulator when `NFE_TEST_PROVIDER` is
 * `fake`. The real SEFAZ gateway joins the registry when it implements issue and consult (PR 4).
 */
@Module({
  imports: [
    CompanyModule,
    TypeOrmModule.forFeature([
      NfeDocumentOrmEntity,
      NfeDocumentItemOrmEntity,
      NfeDocumentHistoryOrmEntity,
      NfeNumberSequenceOrmEntity,
    ]),
  ],
  controllers: [NfeValidateController],
  providers: [
    NfeValidateService,
    TypeormNfeNumbering,
    { provide: INfeNumberPreview, useExisting: TypeormNfeNumbering },
    { provide: INfeDocumentRepository, useClass: TypeOrmNfeDocumentRepository },
    { provide: NFE_SCHEMA_VALIDATOR, useClass: XmllintSchemaValidator },
  ],
  exports: [INfeDocumentRepository, TypeormNfeNumbering],
})
export class NfeModule implements OnModuleInit {
  constructor(
    private readonly registry: FiscalDocumentRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get<string>('NFE_TEST_PROVIDER') === 'fake' &&
      !this.registry.has('nfe')
    )
      this.registry.register(new FakeNfeGateway());
  }
}
