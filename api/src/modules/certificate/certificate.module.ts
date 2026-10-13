import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CertificateOrmEntity } from './infra/certificate.orm-entity';
import { TypeOrmCertificateRepository } from './infra/typeorm-certificate.repository';
import { CertificateEncryptor } from './infra/aes-encryptor';
import { ICertificateRepository } from './domain/certificate.repository';
import { CertificateParserService } from './domain/certificate-parser.service';
import { CertificateService } from './application/certificate.service';
import { ApplicationCertificateDecryptor } from './application/certificate-decryptor';
import { CertificateController } from './http/certificate.controller';
import { CompanyModule } from '@/modules/company/company.module';
import { CertificateExpiryScheduler } from './jobs/certificate-expiry.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([CertificateOrmEntity]),
    forwardRef(() => CompanyModule),
  ],
  controllers: [CertificateController],
  providers: [
    { provide: ICertificateRepository, useClass: TypeOrmCertificateRepository },
    CertificateParserService,
    CertificateEncryptor,
    CertificateService,
    ApplicationCertificateDecryptor,
    CertificateExpiryScheduler,
  ],
  exports: [
    CertificateService,
    ApplicationCertificateDecryptor,
    ICertificateRepository,
    CertificateParserService,
  ],
})
export class CertificateModule {}
