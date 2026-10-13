import { Certificate, CertificateStatus } from '../domain/certificate';
import { CertificateOrmEntity } from './certificate.orm-entity';

export class CertificateMapper {
  toDomain(orm: CertificateOrmEntity): Certificate {
    return Certificate.reconstitute({
      id: orm.id,
      companyId: orm.companyId,
      serialNumber: orm.serialNumber,
      issuer: orm.issuer,
      subject: orm.subject,
      fingerprint: orm.fingerprint,
      validFrom: orm.validFrom,
      validUntil: orm.validUntil,
      status: orm.status as CertificateStatus,
      encryptedBlob: orm.encryptedBlob,
      encryptedDek: orm.encryptedDek,
      dekIv: orm.dekIv,
      createdAt: orm.createdAt,
      deletedAt: orm.deletedAt ?? undefined,
    });
  }

  toPersistence(domain: Certificate): CertificateOrmEntity {
    const orm = new CertificateOrmEntity();
    const snapshot = domain.toSnapshot();
    orm.id = snapshot.id;
    orm.companyId = snapshot.companyId;
    orm.serialNumber = snapshot.serialNumber;
    orm.issuer = snapshot.issuer;
    orm.subject = snapshot.subject;
    orm.fingerprint = snapshot.fingerprint;
    orm.validFrom = snapshot.validFrom;
    orm.validUntil = snapshot.validUntil;
    orm.status = snapshot.status;
    orm.encryptedBlob = snapshot.encryptedBlob;
    orm.encryptedDek = snapshot.encryptedDek;
    orm.dekIv = snapshot.dekIv;
    orm.createdAt = snapshot.createdAt;
    orm.deletedAt = snapshot.deletedAt ?? undefined;
    return orm;
  }
}
