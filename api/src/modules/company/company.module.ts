import { PlansModule } from '@/modules/plans/plans.module';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyOrmEntity } from './infra/company.orm-entity';
import { CompanyFiscalProfileOrmEntity } from './infra/company-fiscal-profile.orm-entity';
import { CompanyServiceTaxProfileOrmEntity } from './infra/company-service-tax-profile.orm-entity';
import { SimplesRegistryPort } from './domain/registry-check';
import { BrasilApiSimplesRegistry } from '@/infra/external/cnpj/brasilapi-simples-registry';
import { TypeOrmCompanyRepository } from './infra/typeorm-company.repository';
import { TypeOrmCompanyFiscalProfileRepository } from './infra/typeorm-company-fiscal-profile.repository';
import { TypeOrmCompanyServiceTaxProfileRepository } from './infra/typeorm-company-service-tax-profile.repository';
import { ICompanyRepository } from './domain/company.repository';
import { IFiscalProfileRepository } from './domain/fiscal-profile.repository';
import { IServiceTaxProfileRepository } from './domain/service-tax-profile.repository';
import { ICompanyCertificateReader } from './domain/i-company-certificate-reader';
import { CompanyCertificateReader } from './infra/company-certificate-reader';
import { CompanyDomainService } from './domain/company-domain.service';
import { CompanyService } from './application/company.service';
import { CompanyFiscalProfileService } from './application/company-fiscal-profile.service';
import { CompanyServiceTaxProfileService } from './application/company-service-tax-profile.service';
import { CompanyController } from './http/company.controller';
import { MunicipalityAgreementService } from './application/municipality-agreement.service';
import { MunicipalityAgreementPort } from './domain/municipality-agreement';
import { OpenNfseProvider } from '@/infra/external/nfse/open-nfse.provider';
import { CertificateModule } from '@/modules/certificate/certificate.module';

@Module({
  imports: [
    PlansModule,
    TypeOrmModule.forFeature([
      CompanyOrmEntity,
      CompanyFiscalProfileOrmEntity,
      CompanyServiceTaxProfileOrmEntity,
    ]),
    forwardRef(() => CertificateModule),
  ],
  controllers: [CompanyController],
  providers: [
    {
      provide: ICompanyRepository,
      useClass: TypeOrmCompanyRepository,
    },
    {
      provide: IFiscalProfileRepository,
      useClass: TypeOrmCompanyFiscalProfileRepository,
    },
    {
      provide: IServiceTaxProfileRepository,
      useClass: TypeOrmCompanyServiceTaxProfileRepository,
    },
    {
      provide: SimplesRegistryPort,
      // The adapter takes plain options (not injectables): build it here.
      useFactory: () => new BrasilApiSimplesRegistry(),
    },
    {
      provide: ICompanyCertificateReader,
      useClass: CompanyCertificateReader,
    },
    { provide: MunicipalityAgreementPort, useExisting: OpenNfseProvider },
    MunicipalityAgreementService,
    CompanyService,
    CompanyDomainService,
    CompanyFiscalProfileService,
    CompanyServiceTaxProfileService,
  ],
  exports: [
    MunicipalityAgreementService,
    CompanyService,
    CompanyDomainService,
    CompanyFiscalProfileService,
    CompanyServiceTaxProfileService,
    ICompanyRepository,
    IFiscalProfileRepository,
    IServiceTaxProfileRepository,
    ICompanyCertificateReader,
  ],
})
export class CompanyModule {}
