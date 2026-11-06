import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { TaxRegimeNotSupportedError } from '../domain/errors';
import { Company } from '../domain/company';
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
    const service = new CompanyService(repo, {} as any, {} as any, {} as any);
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
  let mockProfiles: {
    record: jest.Mock;
    current: jest.Mock;
    findEffective: jest.Mock;
  };
  let companyDomain: CompanyDomainService;

  const tenantId = 'tenant-123';
  const VALID_CNPJ = '11222333000181';

  const mockCompany = {
    id: 'company-id-1',
    tenantId,
    legalName: 'Test Company',
    taxId: VALID_CNPJ,
    municipalityCode: '3550308',
    environment: 'test' as const,
    status: 'ready' as const,
    fiscalSchemaVersion: 'v2_02',
    createdAt: new Date(),
    updatedAt: new Date(),
    municipalReg: 'INSCRICAO123',
    getMissingForReady: jest.fn().mockReturnValue([]),
    update: jest.fn(),
    markDeleted: jest.fn(),
    toSnapshot: jest.fn().mockReturnValue({}),
  };

  beforeEach(() => {
    mockRepo = createMockRepo();
    companyDomain = new CompanyDomainService();
    mockProfiles = {
      record: jest.fn().mockResolvedValue({}),
      current: jest.fn().mockResolvedValue(null),
      findEffective: jest.fn().mockResolvedValue(null),
    };
    service = new CompanyService(
      mockRepo,
      { getStatus: jest.fn() } as any,
      companyDomain,
      mockProfiles as any,
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

    it('refuses to change the CNPJ and saves nothing', async () => {
      const existingCompany = {
        ...mockCompany,
        id: 'company-1',
        taxId: VALID_CNPJ,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);

      await expect(
        service.update('company-1', { taxId: '22.334.455/0001-86' }, tenantId),
      ).rejects.toBeInstanceOf(FiscalValidationError);
      expect(existingCompany.update).not.toHaveBeenCalled();
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('accepts the same CNPJ again (clients that resend the whole company)', async () => {
      const existingCompany = {
        ...mockCompany,
        id: 'company-1',
        taxId: VALID_CNPJ,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.update('company-1', { taxId: VALID_CNPJ }, tenantId);

      expect(existingCompany.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ taxId: expect.anything() }),
      );
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

  describe('fiscal profile routing', () => {
    const openProfile = {
      id: 'profile-1',
      taxRegime: 'MEI',
      simpleNational: false,
      specialTaxRegime: null,
      ibsCbsRegularOption: false,
      ibsCbsRegularFrom: null,
      simplesIssRate: null,
      validFrom: '2026-01-01',
    };

    it('create writes the initial fiscal profile from the request regime', async () => {
      mockRepo.existsWithTaxId.mockResolvedValue(false);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'Simples Nacional',
          simplesRate: '6.54',
          simpleNational: true,
          specialRegime: undefined,
          municipalityCode: '3550308',
        },
        tenantId,
        'test',
      );

      expect(mockProfiles.record).toHaveBeenCalledWith(
        expect.any(String),
        tenantId,
        expect.objectContaining({
          taxRegime: 'SIMPLES_NACIONAL',
          simpleNational: true,
          specialTaxRegime: null,
          source: 'company_api',
          reviewStatus: 'unreviewed',
          validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    it('create approves the initial profile when the caller is identified', async () => {
      mockRepo.existsWithTaxId.mockResolvedValue(false);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        tenantId,
        'test',
        'api-key-owner',
      );

      expect(mockProfiles.record).toHaveBeenCalledWith(
        expect.any(String),
        tenantId,
        expect.objectContaining({
          taxRegime: 'MEI',
          source: 'company_api',
          reviewStatus: 'approved',
          reviewedBy: 'api-key-owner',
        }),
      );
    });

    it('create derives simpleNational from the regime when omitted', async () => {
      mockRepo.existsWithTaxId.mockResolvedValue(false);
      mockRepo.save.mockImplementation(async (c) => c);

      await service.create(
        {
          legalName: 'X',
          taxId: VALID_CNPJ,
          taxRegime: 'MEI',
          municipalityCode: '3550308',
        },
        tenantId,
        'test',
      );

      expect(mockProfiles.record).toHaveBeenCalledWith(
        expect.any(String),
        tenantId,
        expect.objectContaining({ simpleNational: true }),
      );
    });

    it('update records the changed regime as approved by the caller', async () => {
      const existingCompany = {
        ...mockCompany,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);
      mockProfiles.current.mockResolvedValue(openProfile);

      await service.update(
        'company-id-1',
        { taxRegime: 'Simples Nacional', simplesRate: '6.54' },
        tenantId,
        'test',
        'api-key-owner',
      );

      expect(mockProfiles.record).toHaveBeenCalledWith(
        'company-id-1',
        tenantId,
        expect.objectContaining({
          reviewStatus: 'approved',
          reviewedBy: 'api-key-owner',
        }),
      );
    });

    it('update appends a new profile only when the regime changed', async () => {
      const existingCompany = {
        ...mockCompany,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);
      mockProfiles.current.mockResolvedValue(openProfile);

      await service.update(
        'company-id-1',
        { taxRegime: 'Simples Nacional', simplesRate: '6.54' },
        tenantId,
        'test',
      );
      expect(mockProfiles.record).toHaveBeenCalledTimes(1);

      mockProfiles.record.mockClear();
      await service.update(
        'company-id-1',
        { legalName: 'Novo nome' },
        tenantId,
        'test',
      );
      expect(mockProfiles.record).not.toHaveBeenCalled();
    });

    it('update does not append when the requested regime equals the current one', async () => {
      const existingCompany = {
        ...mockCompany,
        update: jest.fn(),
        toSnapshot: jest.fn().mockReturnValue({}),
      };
      mockRepo.findByIdAndTenantId.mockResolvedValue(existingCompany as any);
      mockRepo.save.mockImplementation(async (c) => c);
      mockProfiles.current.mockResolvedValue({
        ...openProfile,
        taxRegime: 'SIMPLES_NACIONAL',
      });

      await service.update(
        'company-id-1',
        { taxRegime: 'Simples Nacional', simplesRate: '6.54' },
        tenantId,
        'test',
      );
      expect(mockProfiles.record).not.toHaveBeenCalled();
    });

    it('currentRegime reads the open profile into legacy-shaped values', async () => {
      mockProfiles.current.mockResolvedValue({
        ...openProfile,
        taxRegime: 'SIMPLES_NACIONAL',
        simpleNational: true,
        specialTaxRegime: '3',
      });

      const regime = await service.currentRegime('company-id-1', tenantId);

      expect(mockProfiles.current).toHaveBeenCalledWith(
        'company-id-1',
        tenantId,
      );
      expect(regime).toEqual({
        taxRegime: 'Simples Nacional',
        simpleNational: true,
        specialRegime: '3',
      });
    });

    it('currentRegime returns null regime when no profile exists', async () => {
      mockProfiles.current.mockResolvedValue(null);
      const regime = await service.currentRegime('company-id-1', tenantId);
      expect(regime).toEqual({
        taxRegime: null,
        simpleNational: false,
        specialRegime: null,
      });
    });
  });
});

describe('CompanyService regime restriction', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const input = (taxRegime: 'MEI' | 'Lucro Presumido' | 'Lucro Real') => ({
    legalName: 'Empresa',
    taxId: '22.334.455/0001-86',
    taxRegime,
    municipalityCode: '3550308',
  });
  const build = () => {
    const repo = {
      existsWithTaxId: jest.fn().mockResolvedValue(false),
      save: jest.fn(),
      saveWithLimit: jest.fn(),
      findByIdAndTenantId: jest.fn(),
    };
    const profiles = {
      record: jest.fn(),
      current: jest.fn().mockResolvedValue(null),
    };
    const service = new CompanyService(
      repo as never,
      { getStatus: jest.fn() } as never,
      new CompanyDomainService(),
      profiles as never,
    );
    return { service, repo, profiles };
  };

  it.each(['Lucro Presumido', 'Lucro Real'] as const)(
    'refuses %s on create and saves nothing',
    async (regime) => {
      const { service, repo, profiles } = build();
      await expect(
        service.create(input(regime), tenant, 'test'),
      ).rejects.toBeInstanceOf(TaxRegimeNotSupportedError);
      expect(repo.save).not.toHaveBeenCalled();
      expect(profiles.record).not.toHaveBeenCalled();
    },
  );

  it('update refuses a regime change the restriction would reject BEFORE saving the company', async () => {
    const { service, repo, profiles } = build();
    const existing = Company.create(
      {
        legalName: 'Empresa',
        taxId: '22334455000186',
        taxRegime: 'MEI',
        municipalityCode: '3550308',
      },
      tenant,
    );
    repo.findByIdAndTenantId.mockResolvedValue(existing);
    // No current profile: a partial regime change would inherit UNKNOWN.
    profiles.current.mockResolvedValue(null);
    await expect(
      service.update(existing.id, { specialRegime: '1' }, tenant, 'test'),
    ).rejects.toBeInstanceOf(TaxRegimeNotSupportedError);
    expect(repo.save).not.toHaveBeenCalled();
    expect(profiles.record).not.toHaveBeenCalled();
  });
});

describe('CompanyService registry check', () => {
  const company = {
    taxId: '11222333000181',
    municipalityCode: '3550308',
  } as never;
  const service = (lookup: jest.Mock) =>
    new CompanyService(
      {} as never,
      {} as never,
      new CompanyDomainService(),
      {} as never,
      { lookup },
    );

  it('warns when the registry says the MEI is not a MEI', async () => {
    const lookup = jest.fn().mockResolvedValue({
      optanteSimples: true,
      optanteMei: false,
      municipalityCode: '3550308',
    });
    const warnings = await service(lookup).registryWarnings(company, 'MEI');
    expect(lookup).toHaveBeenCalledWith('11222333000181');
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'TAX_REGIME_REGISTRY_MISMATCH' }),
    ]);
  });

  it('never fails or warns when the registry fails', async () => {
    expect(
      await service(
        jest.fn().mockRejectedValue(new Error('down')),
      ).registryWarnings(company, 'MEI'),
    ).toEqual([]);
    expect(
      await service(jest.fn().mockResolvedValue(null)).registryWarnings(
        company,
        'MEI',
      ),
    ).toEqual([]);
  });
});

describe('CompanyService Simples rates on update', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const build = (
    current: { taxRegime: string; simpleNational: boolean } | null,
    companyRate?: string,
  ) => {
    const company = {
      id: 'c1',
      taxId: '11222333000181',
      simplesRate: companyRate,
      update: jest.fn(),
    };
    const repo = {
      findByIdAndTenantId: jest.fn().mockResolvedValue(company),
      save: jest.fn(),
    };
    const profiles = {
      current: jest.fn().mockResolvedValue(
        current && {
          ...current,
          specialTaxRegime: null,
          ibsCbsRegularOption: false,
          ibsCbsRegularFrom: null,
          simplesIssRate: null,
          simplesApuracao: null,
        },
      ),
      record: jest.fn(),
    };
    const service = new CompanyService(
      repo as never,
      {} as never,
      new CompanyDomainService(),
      profiles as never,
    );
    return { service, company, repo };
  };

  it('requires the rate when a company becomes Simples Nacional', async () => {
    const { service, repo } = build({
      taxRegime: 'MEI',
      simpleNational: true,
    });
    await expect(
      service.update('c1', { taxRegime: 'Simples Nacional' }, tenantId),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('updates only the rate of a Simples Nacional company', async () => {
    const { service, company } = build(
      { taxRegime: 'SIMPLES_NACIONAL', simpleNational: true },
      '6.54',
    );
    await service.update('c1', { simplesRate: '7.20' }, tenantId);
    expect(company.update).toHaveBeenCalledWith(
      expect.objectContaining({ simplesRate: '7.20' }),
    );
  });

  it('ignores the rates sent for a MEI', async () => {
    const { service, company } = build({
      taxRegime: 'MEI',
      simpleNational: true,
    });
    await service.update('c1', { simplesRate: '7.20' }, tenantId);
    expect(company.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ simplesRate: expect.anything() }),
    );
  });
});

describe('CompanyService company limit by plan', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const input = {
    legalName: 'Empresa',
    taxId: '22.334.455/0001-86',
    taxRegime: 'MEI' as const,
    municipalityCode: '3550308',
  };
  const build = (maxActiveCompanies: number) => {
    const repo = {
      existsWithTaxId: jest.fn().mockResolvedValue(false),
      save: jest.fn(),
      saveWithLimit: jest.fn(),
      findByIdAndTenantId: jest.fn(),
    };
    const profiles = { record: jest.fn(), current: jest.fn().mockResolvedValue(null) };
    const service = new CompanyService(
      repo as never,
      { getStatus: jest.fn().mockResolvedValue({ maxActiveCompanies }) } as never,
      new CompanyDomainService(),
      profiles as never,
    );
    return { service, repo };
  };

  it('without a plan (limit 1) a live company is saved under the atomic limit', async () => {
    const { service, repo } = build(1);
    await service.create(input, tenant, 'live');
    expect(repo.saveWithLimit).toHaveBeenCalledWith(expect.anything(), 1, tenant);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('with a recurring plan (unlimited) there is no limit check at all', async () => {
    const { service, repo } = build(999999);
    await service.create(input, tenant, 'live');
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.saveWithLimit).not.toHaveBeenCalled();
  });

  it('the test environment is never limited, even without a plan', async () => {
    const { service, repo } = build(1);
    await service.create(input, tenant, 'test');
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.saveWithLimit).not.toHaveBeenCalled();
  });
});

