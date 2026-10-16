import { Company, CompanyEnvironment, CompanyStatus } from '../domain/company';
import { CompanyOrmEntity } from './company.orm-entity';

export class CompanyMapper {
  toDomain(orm: CompanyOrmEntity): Company {
    return Company.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      legalName: orm.legalName,
      tradeName: orm.tradeName,
      taxId: orm.taxId,
      municipalReg: orm.municipalReg ?? undefined,
      sendMunicipalReg: orm.sendMunicipalReg ?? false,
      municipalityCode: orm.municipalityCode,
      defaultServiceCode: orm.defaultServiceCode ?? undefined,
      addressStreet: orm.addressStreet,
      addressNumber: orm.addressNumber,
      addressComplement: orm.addressComplement,
      addressDistrict: orm.addressDistrict,
      addressCity: orm.addressCity,
      addressState: orm.addressState,
      addressZip: orm.addressZip,
      fiscalSchemaVersion: orm.fiscalSchemaVersion,
      environment: orm.environment as CompanyEnvironment,
      status: orm.status as CompanyStatus,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
      deletedAt: orm.deletedAt,
    });
  }

  toPersistence(company: Company): Partial<CompanyOrmEntity> {
    const snap = company.toSnapshot();
    return {
      id: snap.id,
      tenantId: snap.tenantId,
      legalName: snap.legalName,
      tradeName: snap.tradeName,
      taxId: snap.taxId,
      municipalReg: snap.municipalReg ?? null,
      sendMunicipalReg: snap.sendMunicipalReg ?? false,
      municipalityCode: snap.municipalityCode,
      defaultServiceCode: snap.defaultServiceCode ?? null,
      addressStreet: snap.addressStreet,
      addressNumber: snap.addressNumber,
      addressComplement: snap.addressComplement,
      addressDistrict: snap.addressDistrict,
      addressCity: snap.addressCity,
      addressState: snap.addressState,
      addressZip: snap.addressZip,
      fiscalSchemaVersion: snap.fiscalSchemaVersion,
      environment: snap.environment,
      status: snap.status,
      createdAt: snap.createdAt,
      updatedAt: snap.updatedAt,
      deletedAt: snap.deletedAt,
    };
  }
}
