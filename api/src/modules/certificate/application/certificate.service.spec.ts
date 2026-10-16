import { CertificateService } from './certificate.service';
import { CertificateEncryptor } from '../infra/aes-encryptor';
import { ICertificateRepository } from '../domain/certificate.repository';
import { ICompanyRepository } from '@/modules/company/domain/company.repository';
import { CertificateParserService } from '../domain/certificate-parser.service';
import {
  CertificateNotFoundError,
  CertificateInvalidError,
  CertificateExpiredError,
  CertificateTaxIdMismatchError,
} from '../domain/errors';

// Helper to create a mock repository
function createMockRepo() {
  return {
    findById: jest.fn(),
    findByIdAndCompanyId: jest.fn(),
    findActiveByCompanyId: jest.fn(),
    save: jest.fn(),
    existsActiveForCompany: jest.fn(),
  } as jest.Mocked<ICertificateRepository>;
}

function createMockCompanyRepo() {
  return {
    findById: jest.fn(),
    findByIdAndTenantId: jest.fn(),
    findByTenantId: jest.fn(),
    save: jest.fn(),
    existsWithTaxId: jest.fn(),
    findAllActive: jest.fn(),
  } as jest.Mocked<ICompanyRepository>;
}

function createMockEncryptor() {
  return {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  } as jest.Mocked<CertificateEncryptor>;
}

function createMockParser() {
  return {
    parseP12: jest.fn(),
    extractCNPJFromSubject: jest.fn(),
  } as jest.Mocked<CertificateParserService>;
}

describe('CertificateService', () => {
  let service: CertificateService;
  let mockRepo: jest.Mocked<ICertificateRepository>;
  let mockCompanyRepo: jest.Mocked<ICompanyRepository>;
  let mockEncryptor: jest.Mocked<CertificateEncryptor>;
  let mockParser: jest.Mocked<CertificateParserService>;

  const tenantId = 'tenant-123';
  const companyId = 'company-456';

  const mockCompany = {
    id: companyId,
    tenantId,
    legalName: 'Test Company',
    taxId: '12345678000190',
    environment: 'sandbox' as const,
    status: 'ready' as const,
    fiscalSchemaVersion: 'v2_02',
    createdAt: new Date(),
    updatedAt: new Date(),
    recomputeStatus: jest.fn(),
  };

  beforeEach(() => {
    mockRepo = createMockRepo();
    mockCompanyRepo = createMockCompanyRepo();
    mockEncryptor = createMockEncryptor();
    mockParser = createMockParser();
    service = new CertificateService(
      mockRepo,
      mockCompanyRepo,
      mockEncryptor,
      mockParser,
    );
  });

  describe('upload', () => {
    const validParsedP12 = {
      serialNumber: '01',
      issuer: 'CN=Test Issuer',
      subject: 'CN=CNPJ 12345678000190, O=Test Company',
      fingerprint: 'ABC123DEF456',
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      p12Buffer: Buffer.from('fake-p12'),
    };

    beforeEach(() => {
      mockParser.parseP12.mockReturnValue(validParsedP12);
      mockParser.extractCNPJFromSubject.mockReturnValue('12345678000190');
    });

    it('parses P12 and uploads valid certificate', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);
      mockEncryptor.encrypt.mockResolvedValue({
        encryptedBlob: Buffer.from('encrypted-blob'),
        encryptedDek: Buffer.from('encrypted-dek'),
        dekIv: Buffer.from('dek-iv-12345'),
      });
      mockRepo.save.mockImplementation(async (cert) => cert);

      const result = await service.upload(
        companyId,
        tenantId,
        p12Buffer,
        'password',
      );

      expect(result.companyId).toBe(companyId);
      expect(result.status).toBe('active');
      expect(mockParser.parseP12).toHaveBeenCalledWith(p12Buffer, 'password');
      expect(mockEncryptor.encrypt).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('rejects certificate with wrong CNPJ', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');
      mockParser.extractCNPJFromSubject.mockReturnValue('99999999000199'); // Different CNPJ

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);

      await expect(
        service.upload(companyId, tenantId, p12Buffer, 'password'),
      ).rejects.toBeInstanceOf(CertificateTaxIdMismatchError);
    });

    it('tells which CNPJs were compared when they differ', async () => {
      mockParser.extractCNPJFromSubject.mockReturnValue('99999999000199');
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);

      const error = (await service
        .upload(companyId, tenantId, Buffer.from('fake-p12-file'), 'password')
        .catch((e: unknown) => e)) as CertificateTaxIdMismatchError;
      expect(error.safeDetails).toEqual({
        certificateTaxId: '99999999000199',
        companyTaxId: mockCompany.taxId,
      });
    });

    it('prefers the tax id the parser read from the certificate itself', async () => {
      mockParser.parseP12.mockReturnValue({
        serialNumber: 'AB',
        issuer: 'CN=AC',
        subject: 'CN=SOMETHING',
        fingerprint: 'FP',
        validFrom: new Date('2024-01-01'),
        validUntil: new Date('2099-01-01'),
        p12Buffer: Buffer.from('x'),
        taxId: mockCompany.taxId,
      });
      mockParser.extractCNPJFromSubject.mockReturnValue('99999999000199');
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);
      mockEncryptor.encrypt.mockResolvedValue({
        encryptedBlob: Buffer.from('b'),
        encryptedDek: Buffer.from('d'),
        dekIv: Buffer.from('i'),
      });
      mockRepo.save.mockResolvedValue(undefined as any);

      await expect(
        service.upload(companyId, tenantId, Buffer.from('p12'), 'password'),
      ).resolves.toBeDefined();
    });

    it('rejects expired certificate', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');
      mockParser.parseP12.mockReturnValue({
        ...validParsedP12,
        validUntil: new Date(Date.now() - 86400000), // Expired yesterday
      });

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);

      await expect(
        service.upload(companyId, tenantId, p12Buffer, 'password'),
      ).rejects.toBeInstanceOf(CertificateExpiredError);
    });

    it('throws CertificateInvalidError for bad P12 password', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');
      mockParser.parseP12.mockImplementation(() => {
        throw new CertificateInvalidError('Invalid password');
      });

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);

      await expect(
        service.upload(companyId, tenantId, p12Buffer, 'wrong-password'),
      ).rejects.toBeInstanceOf(CertificateInvalidError);
    });

    it('throws when company not found', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.upload(companyId, tenantId, p12Buffer, 'password'),
      ).rejects.toBeInstanceOf(CertificateNotFoundError);
    });

    it('revokes existing active certificate before uploading new one', async () => {
      const p12Buffer = Buffer.from('fake-p12-file');

      const existingCert = {
        id: 'existing-cert-id',
        companyId,
        status: 'active' as const,
        markRevoked: jest.fn(),
        markDeleted: jest.fn(),
      };

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(existingCert as any);
      mockEncryptor.encrypt.mockResolvedValue({
        encryptedBlob: Buffer.from('encrypted-blob'),
        encryptedDek: Buffer.from('encrypted-dek'),
        dekIv: Buffer.from('dek-iv-12345'),
      });
      mockRepo.save.mockImplementation(async (cert) => cert);

      await service.upload(companyId, tenantId, p12Buffer, 'password');

      expect(existingCert.markRevoked).toHaveBeenCalled();
      expect(existingCert.markDeleted).toHaveBeenCalled();
    });
  });

  describe('listByCompany', () => {
    it('lists certificates for a company (metadata only, no blob)', async () => {
      const activeCert = {
        id: 'cert-1',
        companyId,
        serialNumber: '01',
        issuer: 'Test Issuer',
        subject: 'CN=12345678000190',
        fingerprint: 'ABC123',
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 86400000),
        status: 'active' as const,
        createdAt: new Date(),
        toMetadata: jest.fn().mockReturnValue({
          id: 'cert-1',
          companyId,
          serialNumber: '01',
          issuer: 'Test Issuer',
          subject: 'CN=12345678000190',
          fingerprint: 'ABC123',
          validFrom: new Date(),
          validUntil: new Date(Date.now() + 86400000),
          status: 'active' as const,
          createdAt: new Date(),
        }),
      };

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(activeCert as any);

      const result = await service.listByCompany(companyId, tenantId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cert-1');
      expect(activeCert.toMetadata).toHaveBeenCalled();
    });

    it('returns empty array when no certificates exist', async () => {
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);

      const result = await service.listByCompany(companyId, tenantId);

      expect(result).toHaveLength(0);
    });

    it('throws when company not found', async () => {
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.listByCompany(companyId, tenantId),
      ).rejects.toBeInstanceOf(CertificateNotFoundError);
    });
  });

  describe('revoke', () => {
    it('soft-deletes certificate on revoke', async () => {
      const cert = {
        id: 'cert-1',
        companyId,
        status: 'active' as const,
        markRevoked: jest.fn(),
        markDeleted: jest.fn(),
      };

      mockRepo.findById.mockResolvedValue(cert as any);
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.revoke('cert-1', tenantId);

      expect(cert.markRevoked).toHaveBeenCalled();
      expect(cert.markDeleted).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalledWith(cert, tenantId, 'test');
    });

    it('throws when certificate not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.revoke('non-existent', tenantId),
      ).rejects.toBeInstanceOf(CertificateNotFoundError);
    });

    it('throws when company does not belong to tenant', async () => {
      mockRepo.findById.mockResolvedValue({
        id: 'cert-1',
        companyId,
        status: 'active' as const,
        markRevoked: jest.fn(),
        markDeleted: jest.fn(),
      } as any);
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.revoke('cert-1', 'wrong-tenant'),
      ).rejects.toBeInstanceOf(CertificateNotFoundError);
    });
  });

  describe('getActive', () => {
    it('returns active certificate', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const cert = {
        id: 'cert-1',
        companyId,
        validUntil: futureDate,
        status: 'active' as const,
        markExpired: jest.fn(),
      };

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(cert as any);

      const result = await service.getActive(companyId, tenantId);

      expect(result.id).toBe('cert-1');
    });

    it('throws when certificate not found', async () => {
      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(null);

      await expect(
        service.getActive(companyId, tenantId),
      ).rejects.toBeInstanceOf(CertificateNotFoundError);
    });

    it('returns active certificate and marks expired if past validUntil', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      const cert = {
        id: 'cert-1',
        companyId,
        validUntil: pastDate,
        status: 'active' as const,
        markExpired: jest.fn(),
      };

      mockCompanyRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);
      mockRepo.findActiveByCompanyId.mockResolvedValue(cert as any);
      mockRepo.save.mockImplementation(async (c) => c);
      mockCompanyRepo.save.mockImplementation(async (c) => c);

      await expect(
        service.getActive(companyId, tenantId),
      ).rejects.toBeInstanceOf(CertificateExpiredError);

      expect(cert.markExpired).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalledWith(cert, tenantId, 'test');
    });
  });
});
