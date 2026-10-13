import { PlansModule } from '@/modules/plans/plans.module';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyOrmEntity } from './infra/company.orm-entity';
import { TypeOrmCompanyRepository } from './infra/typeorm-company.repository';
import { ICompanyRepository } from './domain/company.repository';
import { ICompanyCertificateReader } from './domain/i-company-certificate-reader';
import { CompanyCertificateReader } from './infra/company-certificate-reader';
import { CompanyDomainService } from './domain/company-domain.service';
import { CompanyService } from './application/company.service';
import { CompanyController } from './http/company.controller';
import { CertificateModule } from '@/modules/certificate/certificate.module';

@Module({
  imports: [
    PlansModule,
    TypeOrmModule.forFeature([CompanyOrmEntity]),
    forwardRef(() => CertificateModule),
  ],
  controllers: [CompanyController],
  providers: [
    {
      provide: ICompanyRepository,
      useClass: TypeOrmCompanyRepository,
    },
    {
      provide: ICompanyCertificateReader,
      useClass: CompanyCertificateReader,
    },
    CompanyService,
    CompanyDomainService,
  ],
  exports: [
    CompanyService,
    CompanyDomainService,
    ICompanyRepository,
    ICompanyCertificateReader,
  ],
})
export class CompanyModule {}
