import { FiscalValidationError } from '@/shared/fiscal/fiscal-validation-error';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RolloutFlagsService } from '@/shared/rollout/rollout-flags.service';
import { TaxRegimeNotSupportedError } from '../domain/errors';
import { CompanyFiscalProfileService } from './company-fiscal-profile.service';
import type { CompanyFiscalProfile } from '../domain/fiscal-profile';
import type {
  IFiscalProfileRepository,
  NewFiscalProfile,
} from '../domain/fiscal-profile.repository';

const tenantId = 'tenant-fixture';
const companyId = 'company-fixture';

const makeProfile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'profile-fixture',
  tenantId,
  companyId,
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
  validFrom: '2026-01-01',
  validUntil: null,
  source: 'company_legacy',
  reviewStatus: 'unreviewed',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  ...overrides,
});

const makeInput = (
  overrides: Partial<NewFiscalProfile> = {},
): NewFiscalProfile => ({
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  simplesIssRate: null,
  validFrom: '2026-06-01',
  source: 'manual',
  reviewStatus: 'unreviewed',
  reviewedBy: null,
  ...overrides,
});

class FakeFiscalProfileRepository implements IFiscalProfileRepository {
  readonly appendCalls: Array<{
    companyId: string;
    tenantId: string;
    input: NewFiscalProfile;
  }> = [];
  readonly markApprovedCalls: Array<{
    id: string;
    tenantId: string;
    reviewedBy: string;
    at: Date;
  }> = [];

  constructor(private readonly stored: CompanyFiscalProfile | null = null) {}

  findEffective(): Promise<CompanyFiscalProfile | null> {
    return Promise.resolve(null);
  }
  findOpen(): Promise<CompanyFiscalProfile | null> {
    return Promise.resolve(null);
  }
  findOpenByCompanyIds(): Promise<CompanyFiscalProfile[]> {
    return Promise.resolve([]);
  }
  list(): Promise<CompanyFiscalProfile[]> {
    return Promise.resolve([]);
  }
  findById(
    id: string,
    scopedTenant: string,
  ): Promise<CompanyFiscalProfile | null> {
    const found =
      this.stored &&
      this.stored.id === id &&
      this.stored.tenantId === scopedTenant
        ? this.stored
        : null;
    return Promise.resolve(found);
  }
  append(
    appendedCompanyId: string,
    scopedTenant: string,
    input: NewFiscalProfile,
  ): Promise<CompanyFiscalProfile> {
    this.appendCalls.push({
      companyId: appendedCompanyId,
      tenantId: scopedTenant,
      input,
    });
    return Promise.resolve(
      makeProfile({
        id: 'profile-appended',
        companyId: appendedCompanyId,
        tenantId: scopedTenant,
        taxRegime: input.taxRegime,
        simpleNational: input.simpleNational,
        specialTaxRegime: input.specialTaxRegime,
        ibsCbsRegularOption: input.ibsCbsRegularOption,
        ibsCbsRegularFrom: input.ibsCbsRegularFrom,
        simplesIssRate: input.simplesIssRate,
        validFrom: input.validFrom,
        source: input.source,
        reviewStatus: input.reviewStatus,
        reviewedBy: input.reviewedBy,
      }),
    );
  }
  markApproved(
    id: string,
    scopedTenant: string,
    reviewedBy: string,
    at: Date,
  ): Promise<CompanyFiscalProfile> {
    this.markApprovedCalls.push({ id, tenantId: scopedTenant, reviewedBy, at });
    return Promise.resolve(
      makeProfile({
        id,
        tenantId: scopedTenant,
        reviewStatus: 'approved',
        reviewedBy,
        reviewedAt: at,
      }),
    );
  }
}

describe('CompanyFiscalProfileService', () => {
  it('record delegates to the repository append', async () => {
    const repository = new FakeFiscalProfileRepository();
    const service = new CompanyFiscalProfileService(repository);
    const input = makeInput();

    const result = await service.record(companyId, tenantId, input);

    expect(repository.appendCalls).toEqual([{ companyId, tenantId, input }]);
    expect(result.id).toBe('profile-appended');
    expect(result.validFrom).toBe('2026-06-01');
  });

  it('record rejects an out-of-range simplesIssRate before reaching the repository', async () => {
    const repository = new FakeFiscalProfileRepository();
    const service = new CompanyFiscalProfileService(repository);

    await expect(
      service.record(
        companyId,
        tenantId,
        makeInput({ simplesIssRate: '5.01' }),
      ),
    ).rejects.toBeInstanceOf(FiscalValidationError);
    expect(repository.appendCalls).toHaveLength(0);
  });

  it('approve marks the profile approved and stamps reviewer', async () => {
    const repository = new FakeFiscalProfileRepository(
      makeProfile({ id: 'profile-1' }),
    );
    const service = new CompanyFiscalProfileService(repository);

    const result = await service.approve(
      companyId,
      tenantId,
      'profile-1',
      'reviewer@example.invalid',
    );

    expect(repository.markApprovedCalls).toEqual([
      {
        id: 'profile-1',
        tenantId,
        reviewedBy: 'reviewer@example.invalid',
        at: expect.any(Date),
      },
    ]);
    expect(result.reviewStatus).toBe('approved');
    expect(result.reviewedBy).toBe('reviewer@example.invalid');
    expect(result.reviewedAt).toBeInstanceOf(Date);
  });

  it('approve of an unknown profile throws NotFoundException', async () => {
    const repository = new FakeFiscalProfileRepository(null);
    const service = new CompanyFiscalProfileService(repository);

    await expect(
      service.approve(
        companyId,
        tenantId,
        'missing',
        'reviewer@example.invalid',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.markApprovedCalls).toHaveLength(0);
  });
});

describe('CompanyFiscalProfileService regime restriction', () => {
  const restricted = new RolloutFlagsService(
    new ConfigService({
      rollout: {
        taxRegimeRestriction: { on: true, tenants: '*' },
        fiscalDpsConformance: { on: false, tenants: '*' },
        simplesTottrib: { on: false, tenants: '*' },
        cnpjRegistryCheck: { on: false, tenants: '*' },
        simplesRateMode: { mode: 'off', tenants: '*' },
        simplesRateEnforcedFrom: null,
      },
    }),
  );

  it.each([
    'LUCRO_PRESUMIDO',
    'LUCRO_REAL',
    'OUTRO_REGIME',
    'UNKNOWN',
  ] as const)(
    'record refuses %s and never reaches the repository when the flag is on',
    async (taxRegime) => {
      const repository = new FakeFiscalProfileRepository();
      const service = new CompanyFiscalProfileService(repository, restricted);
      await expect(
        service.record(companyId, tenantId, makeInput({ taxRegime })),
      ).rejects.toBeInstanceOf(TaxRegimeNotSupportedError);
      expect(repository.appendCalls).toEqual([]);
    },
  );

  it('record still accepts MEI and Simples Nacional when the flag is on', async () => {
    const repository = new FakeFiscalProfileRepository();
    const service = new CompanyFiscalProfileService(repository, restricted);
    for (const taxRegime of ['MEI', 'SIMPLES_NACIONAL'] as const)
      await expect(
        service.record(companyId, tenantId, makeInput({ taxRegime })),
      ).resolves.toBeDefined();
  });
});
