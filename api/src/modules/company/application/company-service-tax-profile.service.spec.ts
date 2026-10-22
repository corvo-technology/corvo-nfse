import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyServiceTaxProfileService } from './company-service-tax-profile.service';
import type { CompanyServiceTaxProfile } from '../domain/service-tax-profile';
import type {
  IServiceTaxProfileRepository,
  NewServiceTaxProfile,
} from '../domain/service-tax-profile.repository';

const tenantId = 'tenant-fixture';
const companyId = 'company-fixture';

const makeProfile = (
  overrides: Partial<CompanyServiceTaxProfile> = {},
): CompanyServiceTaxProfile => ({
  id: 'profile-fixture',
  tenantId,
  companyId,
  name: 'Limpeza predial',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  operationNature: 'SERVICE',
  regimeApplicability: [],
  incidenceMunicipalityCode: null,
  issTaxation: 'NORMAL',
  issRate: '5',
  issWithholdingDefault: false,
  withholdingPolicy: 'UNKNOWN',
  withholdingRates: {},
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'unreviewed',
  catalogVersion: null,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  ...overrides,
});

const makeInput = (
  overrides: Partial<NewServiceTaxProfile> = {},
): NewServiceTaxProfile => ({
  name: 'Limpeza predial',
  serviceCode: '010101',
  municipalServiceCode: null,
  nbsCode: null,
  cst: null,
  classCode: null,
  operationIndicator: null,
  operationNature: 'SERVICE',
  regimeApplicability: [],
  incidenceMunicipalityCode: null,
  issTaxation: 'NORMAL',
  issRate: '5',
  issWithholdingDefault: false,
  withholdingPolicy: 'UNKNOWN',
  withholdingRates: {},
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  classificationSource: 'manual',
  reviewStatus: 'unreviewed',
  catalogVersion: null,
  ...overrides,
});

class FakeServiceTaxProfileRepository implements IServiceTaxProfileRepository {
  readonly upsertCalls: Array<{
    id: string | null;
    companyId: string;
    tenantId: string;
    input: NewServiceTaxProfile;
  }> = [];
  readonly deleteCalls: Array<{ id: string }> = [];

  constructor(
    private readonly byId: Map<string, CompanyServiceTaxProfile> = new Map(),
    private readonly effectiveByCode: CompanyServiceTaxProfile[] = [],
    private readonly effectiveByCompany: CompanyServiceTaxProfile[] = [],
  ) {}

  findEffectiveByCompanyAndCode(): Promise<CompanyServiceTaxProfile[]> {
    return Promise.resolve(this.effectiveByCode);
  }
  findEffectiveByCompany(): Promise<CompanyServiceTaxProfile[]> {
    return Promise.resolve(this.effectiveByCompany);
  }
  findById(
    id: string,
    scopedCompanyId: string,
    scopedTenant: string,
  ): Promise<CompanyServiceTaxProfile | null> {
    const found = this.byId.get(id) ?? null;
    const scoped =
      found &&
      found.companyId === scopedCompanyId &&
      found.tenantId === scopedTenant
        ? found
        : null;
    return Promise.resolve(scoped);
  }
  async markApproved(
    id: string,
    scopedCompanyId: string,
    scopedTenant: string,
  ): Promise<CompanyServiceTaxProfile> {
    const profile = await this.findById(id, scopedCompanyId, scopedTenant);
    if (!profile) throw new NotFoundException('Service tax profile not found');
    return { ...profile, reviewStatus: 'approved' };
  }
  upsert(
    id: string | null,
    scopedCompanyId: string,
    scopedTenant: string,
    input: NewServiceTaxProfile,
  ): Promise<CompanyServiceTaxProfile> {
    this.upsertCalls.push({
      id,
      companyId: scopedCompanyId,
      tenantId: scopedTenant,
      input,
    });
    return Promise.resolve(
      makeProfile({
        id: id ?? 'profile-created',
        companyId: scopedCompanyId,
        tenantId: scopedTenant,
        name: input.name,
        serviceCode: input.serviceCode,
        issTaxation: input.issTaxation,
        issRate: input.issRate,
        withholdingPolicy: input.withholdingPolicy,
        withholdingRates: input.withholdingRates,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        classificationSource: input.classificationSource,
        reviewStatus: input.reviewStatus,
      }),
    );
  }
  delete(id: string): Promise<void> {
    this.deleteCalls.push({ id });
    return Promise.resolve();
  }
}

describe('CompanyServiceTaxProfileService', () => {
  it('upsert creates a profile when no id is given, after validating it', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    const result = await service.upsert(companyId, tenantId, null, makeInput());

    expect(repository.upsertCalls).toEqual([
      { id: null, companyId, tenantId, input: makeInput() },
    ]);
    expect(result.id).toBe('profile-created');
    expect(result.effectiveFrom).toBe('2026-01-01');
  });

  it('upsert rejects a service code that is not six digits with FiscalValidationError', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.upsert(
        companyId,
        tenantId,
        null,
        makeInput({ serviceCode: '12345' }),
      ),
    ).rejects.toMatchObject({
      name: 'FiscalValidationError',
      issues: [
        expect.objectContaining({ field: 'serviceCode', code: 'invalid' }),
      ],
    });
    expect(repository.upsertCalls).toHaveLength(0);
  });

  it('upsert rejects CONFIGURED withholding without any rate', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.upsert(
        companyId,
        tenantId,
        null,
        makeInput({ withholdingPolicy: 'CONFIGURED', withholdingRates: {} }),
      ),
    ).rejects.toMatchObject({
      name: 'FiscalValidationError',
      issues: [
        expect.objectContaining({
          field: 'withholdingRates',
          code: 'required',
        }),
      ],
    });
  });

  it('upsert rejects an effectiveUntil that is not after effectiveFrom', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.upsert(
        companyId,
        tenantId,
        null,
        makeInput({
          effectiveFrom: '2026-06-01',
          effectiveUntil: '2026-01-01',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'FiscalValidationError',
      issues: [
        expect.objectContaining({
          field: 'effectiveUntil',
          code: 'out_of_range',
        }),
      ],
    });
  });

  it('upsert refuses to rewrite an approved profile keeping the same effectiveFrom', async () => {
    const repository = new FakeServiceTaxProfileRepository(
      new Map([
        [
          'profile-1',
          makeProfile({ id: 'profile-1', reviewStatus: 'approved' }),
        ],
      ]),
    );
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.upsert(companyId, tenantId, 'profile-1', makeInput()),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.upsert(companyId, tenantId, 'profile-1', makeInput()),
    ).rejects.toThrow('immutable_approved_profile');
    expect(repository.upsertCalls).toHaveLength(0);
  });

  it('upsert updates an unreviewed profile with the same effectiveFrom in place', async () => {
    const repository = new FakeServiceTaxProfileRepository(
      new Map([['profile-1', makeProfile({ id: 'profile-1' })]]),
    );
    const service = new CompanyServiceTaxProfileService(repository);

    const updated = await service.upsert(
      companyId,
      tenantId,
      'profile-1',
      makeInput({ name: 'Revisada' }),
    );

    expect(repository.upsertCalls).toEqual([
      {
        id: 'profile-1',
        companyId,
        tenantId,
        input: makeInput({ name: 'Revisada' }),
      },
    ]);
    expect(updated.name).toBe('Revisada');
  });

  it('upsert rejects a profile id that does not belong to the company', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.upsert(companyId, tenantId, 'missing', makeInput()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.upsertCalls).toHaveLength(0);
  });

  it('delete removes an expired unreviewed profile', async () => {
    const repository = new FakeServiceTaxProfileRepository(
      new Map([
        [
          'profile-1',
          makeProfile({ id: 'profile-1', effectiveUntil: '2026-06-01' }),
        ],
      ]),
    );
    const service = new CompanyServiceTaxProfileService(repository);

    await service.delete(companyId, tenantId, 'profile-1', '2026-10-13');

    expect(repository.deleteCalls).toEqual([{ id: 'profile-1' }]);
  });

  it('delete refuses an approved profile regardless of expiry', async () => {
    const repository = new FakeServiceTaxProfileRepository(
      new Map([
        [
          'profile-1',
          makeProfile({
            id: 'profile-1',
            reviewStatus: 'approved',
            effectiveUntil: '2026-06-01',
          }),
        ],
      ]),
    );
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.delete(companyId, tenantId, 'profile-1', '2026-10-13'),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.delete(companyId, tenantId, 'profile-1', '2026-10-13'),
    ).rejects.toThrow('immutable_approved_profile');
    expect(repository.deleteCalls).toHaveLength(0);
  });

  it('delete refuses a profile that is still effective today', async () => {
    const repository = new FakeServiceTaxProfileRepository(
      new Map([['profile-1', makeProfile({ id: 'profile-1' })]]),
    );
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.delete(companyId, tenantId, 'profile-1', '2026-10-13'),
    ).rejects.toThrow('service_profile_still_effective');
    expect(repository.deleteCalls).toHaveLength(0);
  });

  it('delete rejects an unknown profile id', async () => {
    const repository = new FakeServiceTaxProfileRepository();
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.delete(companyId, tenantId, 'missing', '2026-10-13'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list returns the profiles effective for the company on the date', async () => {
    const stored = makeProfile();
    const repository = new FakeServiceTaxProfileRepository(
      new Map(),
      [],
      [stored],
    );
    const service = new CompanyServiceTaxProfileService(repository);

    await expect(
      service.list(companyId, tenantId, '2026-01-01'),
    ).resolves.toEqual([stored]);
  });

  describe('resolveProfileForFiscalEngine', () => {
    it('resolves the explicitly requested profile when it belongs to the company, matches the service code and is effective', async () => {
      const stored = makeProfile({
        id: 'profile-1',
        reviewStatus: 'approved',
        issRate: '3.5',
        withholdingPolicy: 'CONFIGURED',
        withholdingRates: { irrf: '1.5' },
        classificationSource: 'manual',
      });
      const repository = new FakeServiceTaxProfileRepository(
        new Map([['profile-1', stored]]),
      );
      const service = new CompanyServiceTaxProfileService(repository);

      const resolved = await service.resolveProfileForFiscalEngine(
        companyId,
        tenantId,
        'profile-1',
        '010101',
        '2026-02-01',
      );

      expect(resolved).toEqual({
        classification: expect.objectContaining({
          serviceCode: '010101',
          source: 'company_service_profile',
          serviceProfileId: 'profile-1',
          operationNature: 'SERVICE',
          iss: {
            taxation: 'NORMAL',
            rate: '3.5',
            withholdingDefault: false,
            incidenceMunicipalityCode: null,
          },
          withholding: { policy: 'CONFIGURED', rates: { irrf: '1.5' } },
          catalogValidated: false,
        }),
        review: 'approved',
      });
    });

    it('reports an unknown requested profile id', async () => {
      const repository = new FakeServiceTaxProfileRepository();
      const service = new CompanyServiceTaxProfileService(repository);

      await expect(
        service.resolveProfileForFiscalEngine(
          companyId,
          tenantId,
          'missing',
          '010101',
          '2026-02-01',
        ),
      ).resolves.toMatchObject({ code: 'service_profile_not_found' });
    });

    it('reports a requested profile for another service code', async () => {
      const repository = new FakeServiceTaxProfileRepository(
        new Map([['profile-1', makeProfile({ id: 'profile-1' })]]),
      );
      const service = new CompanyServiceTaxProfileService(repository);

      await expect(
        service.resolveProfileForFiscalEngine(
          companyId,
          tenantId,
          'profile-1',
          '070102',
          '2026-02-01',
        ),
      ).resolves.toMatchObject({ code: 'service_code_mismatch' });
    });

    it('reports a requested profile that is not effective on the date', async () => {
      const repository = new FakeServiceTaxProfileRepository(
        new Map([
          [
            'profile-1',
            makeProfile({
              id: 'profile-1',
              effectiveFrom: '2026-01-01',
              effectiveUntil: '2026-06-01',
            }),
          ],
        ]),
      );
      const service = new CompanyServiceTaxProfileService(repository);

      await expect(
        service.resolveProfileForFiscalEngine(
          companyId,
          tenantId,
          'profile-1',
          '010101',
          '2026-07-01',
        ),
      ).resolves.toMatchObject({ code: 'service_profile_not_effective' });
    });

    it('reports when no effective profile matches the service code', async () => {
      const repository = new FakeServiceTaxProfileRepository();
      const service = new CompanyServiceTaxProfileService(repository);

      await expect(
        service.resolveProfileForFiscalEngine(
          companyId,
          tenantId,
          null,
          '010101',
          '2026-02-01',
        ),
      ).resolves.toMatchObject({ code: 'no_effective_service_profile' });
    });

    it('reports ambiguity when several effective profiles match', async () => {
      const repository = new FakeServiceTaxProfileRepository(new Map(), [
        makeProfile({ id: 'profile-1' }),
        makeProfile({ id: 'profile-2' }),
      ]);
      const service = new CompanyServiceTaxProfileService(repository);

      await expect(
        service.resolveProfileForFiscalEngine(
          companyId,
          tenantId,
          null,
          '010101',
          '2026-02-01',
        ),
      ).resolves.toMatchObject({ code: 'ambiguous_service_profile' });
    });

    it('resolves the single effective candidate without a requested id', async () => {
      const stored = makeProfile({ id: 'profile-9', reviewStatus: 'rejected' });
      const repository = new FakeServiceTaxProfileRepository(new Map(), [
        stored,
      ]);
      const service = new CompanyServiceTaxProfileService(repository);

      const resolved = await service.resolveProfileForFiscalEngine(
        companyId,
        tenantId,
        null,
        '010101',
        '2026-02-01',
      );

      expect(resolved).toEqual({
        classification: expect.objectContaining({
          serviceProfileId: 'profile-9',
        }),
        review: 'rejected',
      });
    });
  });
});

describe('CompanyServiceTaxProfileService approval', () => {
  it('approves a scoped service without rewriting its classification', async () => {
    const existing = makeProfile();
    const markApproved = jest
      .fn()
      .mockResolvedValue({ ...existing, reviewStatus: 'approved' });
    const profiles = {
      findById: jest.fn().mockResolvedValue(existing),
      markApproved,
      upsert: jest.fn(),
    };
    const result = await new CompanyServiceTaxProfileService(
      profiles as never,
    ).approve(companyId, tenantId, existing.id);
    expect(result.reviewStatus).toBe('approved');
    expect(markApproved).toHaveBeenCalledWith(existing.id, companyId, tenantId);
    expect(profiles.upsert).not.toHaveBeenCalled();
  });
  it('returns an already approved service without writing', async () => {
    const existing = makeProfile({ reviewStatus: 'approved' });
    const markApproved = jest.fn();
    const result = await new CompanyServiceTaxProfileService({
      findById: jest.fn().mockResolvedValue(existing),
      markApproved,
    } as never).approve(companyId, tenantId, existing.id);
    expect(result).toBe(existing);
    expect(markApproved).not.toHaveBeenCalled();
  });
  it('does not approve a service outside the company and tenant scope', async () => {
    const markApproved = jest.fn();
    await expect(
      new CompanyServiceTaxProfileService({
        findById: jest.fn().mockResolvedValue(null),
        markApproved,
      } as never).approve(companyId, 'other-tenant', 'service'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(markApproved).not.toHaveBeenCalled();
  });
  it('validates the saved profile before approving it', async () => {
    const markApproved = jest.fn();
    await expect(
      new CompanyServiceTaxProfileService({
        findById: jest.fn().mockResolvedValue(makeProfile({ issRate: '101' })),
        markApproved,
      } as never).approve(companyId, tenantId, 'service'),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(markApproved).not.toHaveBeenCalled();
  });
});
