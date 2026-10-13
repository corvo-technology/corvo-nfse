import { CompanyService } from './company.service';
import { CompanyDomainService } from '../domain/company-domain.service';
import { ICompanyRepository } from '../domain/company.repository';
import {
  CompanyNotFoundError,
  CompanyNotReadyError,
  CompanyBlockedError,
  CompanyAlreadyExistsError,
} from '../domain/errors';

function createMockRepo() {
  return {
    findById: jest.fn(),
    findByIdAndTenantId: jest.fn(),
    findByTaxIdAndTenantId: jest.fn(),
    findByTenantId: jest.fn(),
    save: jest.fn(),
    existsWithTaxId: jest.fn(),
  } as jest.Mocked<ICompanyRepository>;
}

describe('CompanyService.findByTaxId', () => {
  const tenantId = 'tenant-123';

  function build() {
    const repo = createMockRepo();
    const service = new CompanyService(repo, {} as any, {} as any);
    return { repo, service };
  }

  it('looks the company up by normalized CNPJ', async () => {
    const { repo, service } = build();
    repo.findByTaxIdAndTenantId.mockResolvedValue({ id: 'c-1' } as any);

    const company = await service.findByTaxId(
      '11.222.333/0001-81',
      tenantId,
      'live',
    );

    expect(company.id).toBe('c-1');
    expect(repo.findByTaxIdAndTenantId).toHaveBeenCalledWith(
      '11222333000181',
      tenantId,
      'live',
    );
  });

  it('throws CompanyNotFoundError when no company matches', async () => {
    const { repo, service } = build();
    repo.findByTaxIdAndTenantId.mockResolvedValue(null);

    await expect(
      service.findByTaxId('11222333000181', tenantId),
    ).rejects.toThrow(CompanyNotFoundError);
  });
});

describe('CompanyService', () => {
  let service: CompanyService;
  let mockRepo: jest.Mocked<ICompanyRepository>;
  let companyDomain: CompanyDomainService;

  const tenantId = 'tenant-123';
  const VALID_CNPJ = '11222333000181';

  const mockCompany = {
    id: 'company-id-1',
    tenantId,
    legalName: 'Test Company',
    taxId: VALID_CNPJ,
    taxRegime: 'Simples Nacional' as const,
    municipalityCode: '3550308',
    environment: 'test' as const,
    status: 'ready' as const,
    fiscalSchemaVersion: 'v2_02',
    createdAt: new Date(),
    updatedAt: new Date(),
    simpleNational: true,
    municipalReg: 'INSCRICAO123',
    getMissingForReady: jest.fn().mockReturnValue([]),
    update: jest.fn(),
    markDeleted: jest.fn(),
    toSnapshot: jest.fn().mockReturnValue({}),
  };

  beforeEach(() => {
    mockRepo = createMockRepo();
    companyDomain = new CompanyDomainService();
    service = new CompanyService(
      mockRepo,
      { getStatus: jest.fn() } as any,
      companyDomain,
    );
  });

  describe('create', () => {
    it('creates a company with valid input', async () => {
      const input = {
        legalName: 'New Company',
        taxId: '22.334.455/0001-86',
        taxRegime: 'MEI' as const,
        municipalityCode: '3550308',
      };

      mockRepo.existsWithTaxId.mockResolvedValue(false);
      mockRepo.save.mockImplementation(async (company) => company);

      const result = await service.create(input, tenantId);

      expect(result.legalName).toBe('New Company');
      expect(result.taxId).toBe('22334455000186');
      expect(mockRepo.existsWithTaxId).toHaveBeenCalledWith(
        '22334455000186',
        tenantId,
        undefined,
        'test',
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('throws CompanyAlreadyExistsError on duplicate tax_id', async () => {
      const input = {
        legalName: 'Duplicate Company',
        taxId: '11.222.333/0001-81',
        taxRegime: 'MEI' as const,
        municipalityCode: '3550308',
      };

      mockRepo.existsWithTaxId.mockResolvedValue(true);

      await expect(service.create(input, tenantId)).rejects.toBeInstanceOf(
        CompanyAlreadyExistsError,
      );
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns company when found', async () => {
      mockRepo.findByIdAndTenantId.mockResolvedValue(mockCompany as any);

      const result = await service.findById('company-id-1', tenantId);

      expect(result.id).toBe('company-id-1');
      expect(mockRepo.findByIdAndTenantId).toHaveBeenCalledWith(
        'company-id-1',
        tenantId,
        'test',
      );
    });

    it('throws CompanyNotFoundError when findById misses', async () => {
      mockRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.findById('non-existent', tenantId),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  describe('list', () => {
    it('lists companies by tenant with cursor pagination', async () => {
      const companies = [
        { ...mockCompany, id: 'company-1' },
        { ...mockCompany, id: 'company-2' },
      ];

      mockRepo.findByTenantId.mockResolvedValue(companies as any);

      const result = await service.list(tenantId, 10, undefined);

      expect(result).toHaveLength(2);
      expect(mockRepo.findByTenantId).toHaveBeenCalledWith(
        tenantId,
        10,
        undefined,
        'test',
      );
    });

    it('passes cursor when provided', async () => {
      mockRepo.findByTenantId.mockResolvedValue([]);

      await service.list(tenantId, 10, 'cursor-123');

      expect(mockRepo.findByTenantId).toHaveBeenCalledWith(
        tenantId,
        10,
        'cursor-123',
        'test',
      );
    });

    it('uses default limit when not provided', async () => {
      mockRepo.findByTenantId.mockResolvedValue([]);

      await service.list(tenantId);

      expect(mockRepo.findByTenantId).toHaveBeenCalledWith(
        tenantId,
        undefined,
        undefined,
        'test',
      );
    });
  });

  describe('update', () => {
    it('updates company fields', async () => {
      const existingCompany = {
        ...mockCompany,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.update(
        'company-id-1',
        { legalName: 'Updated Name' },
        tenantId,
      );

      expect(existingCompany.update).toHaveBeenCalledWith({
        legalName: 'Updated Name',
      });
      expect(mockRepo.save).toHaveBeenCalledWith(existingCompany, tenantId);
    });

    it('checks for duplicate taxId when changing', async () => {
      const existingCompany = {
        ...mockCompany,
        id: 'company-1',
        taxId: VALID_CNPJ,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.existsWithTaxId.mockResolvedValue(false);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.update(
        'company-1',
        { taxId: '22.334.455/0001-86' },
        tenantId,
      );

      expect(mockRepo.existsWithTaxId).toHaveBeenCalledWith(
        '22334455000186',
        tenantId,
        'company-1',
        'test',
      );
    });

    it('throws CompanyAlreadyExistsError when changing to duplicate taxId', async () => {
      const existingCompany = {
        ...mockCompany,
        id: 'company-1',
        taxId: VALID_CNPJ,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.existsWithTaxId.mockResolvedValue(true);

      await expect(
        service.update('company-1', { taxId: '22.334.455/0001-86' }, tenantId),
      ).rejects.toBeInstanceOf(CompanyAlreadyExistsError);
    });

    it('does not check duplicate taxId when taxId not in input', async () => {
      const existingCompany = {
        ...mockCompany,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.update('company-id-1', { legalName: 'Updated' }, tenantId);

      expect(mockRepo.existsWithTaxId).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft deletes via markDeleted', async () => {
      const existingCompany = {
        ...mockCompany,
        markDeleted: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.delete('company-id-1', tenantId);

      expect(existingCompany.markDeleted).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalledWith(existingCompany, tenantId);
    });

    it('throws when company not found', async () => {
      mockRepo.findByIdAndTenantId.mockResolvedValue(null);

      await expect(
        service.delete('non-existent', tenantId),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  describe('ensureReady', () => {
    it('throws CompanyBlockedError when blocked', async () => {
      const blockedCompany = {
        ...mockCompany,
        status: 'blocked' as const,
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(blockedCompany as any);

      await expect(
        service.ensureReady('company-id-1', tenantId),
      ).rejects.toBeInstanceOf(CompanyBlockedError);
    });

    it('throws CompanyNotReadyError with missing list', async () => {
      const notReadyCompany = {
        ...mockCompany,
        status: 'pending_setup' as const,
        getMissingForReady: jest
          .fn()
          .mockReturnValue(['municipal_registration']),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(notReadyCompany as any);

      await expect(
        service.ensureReady('company-id-1', tenantId),
      ).rejects.toBeInstanceOf(CompanyNotReadyError);
    });

    it('returns company when ready', async () => {
      const readyCompany = {
        ...mockCompany,
        status: 'ready' as const,
        getMissingForReady: jest.fn().mockReturnValue([]),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(readyCompany as any);

      const result = await service.ensureReady('company-id-1', tenantId);

      expect(result.id).toBe('company-id-1');
      expect(result.status).toBe('ready');
    });

    it('checks getMissingForReady for blocked company', async () => {
      const blockedCompany = {
        ...mockCompany,
        status: 'blocked' as const,
        getMissingForReady: jest.fn(),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(blockedCompany as any);

      await expect(
        service.ensureReady('company-id-1', tenantId),
      ).rejects.toBeInstanceOf(CompanyBlockedError);

      // getMissingForReady should NOT be called because blocked throws first
      expect(blockedCompany.getMissingForReady).not.toHaveBeenCalled();
    });
  });
});
