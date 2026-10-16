import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyController } from './company.controller';
import type { CompanyService } from '../application/company.service';
import type { CompanyFiscalProfileService } from '../application/company-fiscal-profile.service';
import type { CompanyServiceTaxProfileService } from '../application/company-service-tax-profile.service';
import type { ICompanyCertificateReader } from '../domain/i-company-certificate-reader';
import type { UpsertFiscalProfileDto } from './company.dto';
import type {
  AuthContext,
  RequestWithAuthContext,
} from '@/modules/auth/auth-context';
import type { CompanyFiscalProfile } from '../domain/fiscal-profile';
import type { NewFiscalProfile } from '../domain/fiscal-profile.repository';
import type { CompanyServiceTaxProfile } from '../domain/service-tax-profile';
import type { NewServiceTaxProfile } from '../domain/service-tax-profile.repository';
import { todayInEstablishmentTimezone } from '@/shared/dates/date-time';

const companyId = '11111111-1111-4111-8111-111111111111';

const authContext: AuthContext = {
  authUserId: 'user-1',
  productKey: 'corvo',
  userId: 'membership-1',
  tenantId: 'tenant-fixture',
  activeTenantId: 'tenant-fixture',
  role: 'manager',
  contextType: 'tenant',
  platformRole: null,
  platformPermissions: [],
  permissions: [],
  isPlatformAdmin: false,
  executionEnvironment: 'test',
};
const req = { authContext } as RequestWithAuthContext;

const makeFiscalProfile = (
  overrides: Partial<CompanyFiscalProfile> = {},
): CompanyFiscalProfile => ({
  id: 'profile-fixture',
  tenantId: 'tenant-fixture',
  companyId,
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  specialTaxRegime: null,
  ibsCbsRegularOption: false,
  ibsCbsRegularFrom: null,
  validFrom: todayInEstablishmentTimezone(),
  validUntil: null,
  source: 'company_api',
  reviewStatus: 'unreviewed',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  ...overrides,
});

const makeServiceProfile = (
  overrides: Partial<CompanyServiceTaxProfile> = {},
): CompanyServiceTaxProfile => ({
  id: 'service-profile-fixture',
  tenantId: 'tenant-fixture',
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

const fiscalProfileDto = (
  overrides: Partial<UpsertFiscalProfileDto> = {},
): UpsertFiscalProfileDto => ({
  taxRegime: 'SIMPLES_NACIONAL',
  simpleNational: true,
  ...overrides,
});

interface FiscalProfilesFake {
  list: jest.Mock;
  current: jest.Mock;
  record: jest.Mock;
  approve: jest.Mock;
}

interface ServiceTaxProfilesFake {
  findById: jest.Mock;
  list: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
}

const makeController = (
  overrides: {
    fiscalProfiles?: Partial<FiscalProfilesFake>;
    serviceTaxProfiles?: Partial<ServiceTaxProfilesFake>;
  } = {},
) => {
  const companyService = {
    findById: jest.fn().mockResolvedValue({ id: companyId }),
  } as unknown as CompanyService;
  const fiscalProfiles: FiscalProfilesFake = {
    list: jest.fn().mockResolvedValue([]),
    current: jest.fn().mockResolvedValue(null),
    record: jest
      .fn()
      .mockImplementation(
        (_id: string, _tenant: string, input: NewFiscalProfile) =>
          Promise.resolve(makeFiscalProfile(input)),
      ),
    approve: jest
      .fn()
      .mockResolvedValue(makeFiscalProfile({ reviewStatus: 'approved' })),
    ...overrides.fiscalProfiles,
  };
  const serviceTaxProfiles: ServiceTaxProfilesFake = {
    findById: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    upsert: jest
      .fn()
      .mockImplementation(
        (
          _companyId: string,
          _tenant: string,
          _id: string | null,
          input: NewServiceTaxProfile,
        ) => Promise.resolve(makeServiceProfile(input)),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides.serviceTaxProfiles,
  };
  const controller = new CompanyController(
    companyService,
    {} as ICompanyCertificateReader,
    fiscalProfiles as unknown as CompanyFiscalProfileService,
    serviceTaxProfiles as unknown as CompanyServiceTaxProfileService,
  );
  return { controller, companyService, fiscalProfiles, serviceTaxProfiles };
};

describe('CompanyController fiscal profile endpoints', () => {
  it('PUT fiscal-profile without confirm records an unreviewed vigência', async () => {
    const { controller, fiscalProfiles } = makeController();

    await controller.upsertFiscalProfile(companyId, fiscalProfileDto(), req);

    expect(fiscalProfiles.record).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      {
        taxRegime: 'SIMPLES_NACIONAL',
        simpleNational: true,
        specialTaxRegime: null,
        ibsCbsRegularOption: false,
        ibsCbsRegularFrom: null,
        validFrom: todayInEstablishmentTimezone(),
        source: 'company_api',
        reviewStatus: 'unreviewed',
        reviewedBy: null,
      },
    );
  });

  it('PUT fiscal-profile with confirm records an approved vigência stamped with the actor', async () => {
    const { controller, fiscalProfiles } = makeController();

    await controller.upsertFiscalProfile(
      companyId,
      fiscalProfileDto({ confirm: true }),
      req,
    );

    expect(fiscalProfiles.record).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      expect.objectContaining({
        reviewStatus: 'approved',
        reviewedBy: 'user-1',
      }),
    );
  });

  it('PUT fiscal-profile defaults validFrom to today in the establishment timezone', async () => {
    const { controller, fiscalProfiles } = makeController();

    await controller.upsertFiscalProfile(
      companyId,
      fiscalProfileDto({ validFrom: '2026-06-01' }),
      req,
    );

    expect(fiscalProfiles.record).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      expect.objectContaining({ validFrom: '2026-06-01' }),
    );
  });

  it('PUT fiscal-profile is idempotent when the open profile already matches the desired state', async () => {
    const open = makeFiscalProfile({
      id: 'profile-open',
      reviewStatus: 'approved',
      reviewedBy: 'user-1',
    });
    const { controller, fiscalProfiles } = makeController({
      fiscalProfiles: { current: jest.fn().mockResolvedValue(open) },
    });

    const result = await controller.upsertFiscalProfile(
      companyId,
      fiscalProfileDto({ confirm: true }),
      req,
    );

    expect(fiscalProfiles.record).not.toHaveBeenCalled();
    expect(result.data.id).toBe('profile-open');
  });

  it('PUT fiscal-profile propagates the conflict when the open approved profile differs', async () => {
    const open = makeFiscalProfile({ taxRegime: 'LUCRO_REAL' });
    const { controller, fiscalProfiles } = makeController({
      fiscalProfiles: {
        current: jest.fn().mockResolvedValue(open),
        record: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('profile_validity_conflict'),
          ),
      },
    });

    await expect(
      controller.upsertFiscalProfile(
        companyId,
        fiscalProfileDto({ confirm: true }),
        req,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('GET fiscal-profile lists the company history', async () => {
    const history = [makeFiscalProfile({ id: 'profile-1' })];
    const { controller, fiscalProfiles } = makeController({
      fiscalProfiles: { list: jest.fn().mockResolvedValue(history) },
    });

    const result = await controller.listFiscalProfile(companyId, req);

    expect(fiscalProfiles.list).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
    );
    expect(result.data).toEqual(history);
  });

  it('approve forwards the acting user as reviewer and rejects a foreign profile', async () => {
    const { controller, fiscalProfiles } = makeController();
    await controller.approveFiscalProfile(companyId, 'profile-1', req);
    expect(fiscalProfiles.approve).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      'profile-1',
      'user-1',
    );

    const rejecting = makeController({
      fiscalProfiles: {
        approve: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Fiscal profile not found')),
      },
    });
    await expect(
      rejecting.controller.approveFiscalProfile(companyId, 'missing', req),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CompanyController service tax profile endpoints', () => {
  it('POST service-tax-profiles creates an unreviewed catalog entry', async () => {
    const { controller, serviceTaxProfiles } = makeController();

    await controller.createServiceTaxProfile(
      companyId,
      {
        name: 'Limpeza predial',
        serviceCode: '010101',
        effectiveFrom: '2026-01-01',
        withholdingPolicy: 'CONFIGURED',
        withholdingRates: { irrf: '1.5' },
      },
      req,
    );

    expect(serviceTaxProfiles.upsert).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      null,
      expect.objectContaining({
        name: 'Limpeza predial',
        serviceCode: '010101',
        operationNature: 'SERVICE',
        regimeApplicability: [],
        issTaxation: null,
        issRate: null,
        issWithholdingDefault: false,
        withholdingPolicy: 'CONFIGURED',
        withholdingRates: { irrf: '1.5' },
        effectiveFrom: '2026-01-01',
        effectiveUntil: null,
        classificationSource: 'manual',
        reviewStatus: 'unreviewed',
        catalogVersion: null,
      }),
    );
  });

  it('PATCH service-tax-profiles/:serviceId merges the patch over the stored profile', async () => {
    const stored = makeServiceProfile({ id: 'service-1', name: 'Antiga' });
    const { controller, serviceTaxProfiles } = makeController({
      serviceTaxProfiles: {
        findById: jest.fn().mockResolvedValue(stored),
      },
    });

    await controller.updateServiceTaxProfile(
      companyId,
      'service-1',
      { name: 'Nova' },
      req,
    );

    expect(serviceTaxProfiles.upsert).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      'service-1',
      expect.objectContaining({
        name: 'Nova',
        serviceCode: '010101',
        effectiveFrom: '2026-01-01',
      }),
    );
  });

  it('PATCH service-tax-profiles/:serviceId rejects an id outside the company', async () => {
    const { controller } = makeController({
      serviceTaxProfiles: { findById: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      controller.updateServiceTaxProfile(
        companyId,
        'missing',
        { name: 'Nova' },
        req,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE service-tax-profiles/:serviceId closes with today as the reference date', async () => {
    const { controller, serviceTaxProfiles } = makeController();

    await controller.deleteServiceTaxProfile(companyId, 'service-1', req);

    expect(serviceTaxProfiles.delete).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      'service-1',
      todayInEstablishmentTimezone(),
    );
  });

  it('GET service-tax-profiles lists profiles effective today by default', async () => {
    const { controller, serviceTaxProfiles } = makeController();

    await controller.listServiceTaxProfiles(companyId, {}, req);

    expect(serviceTaxProfiles.list).toHaveBeenCalledWith(
      companyId,
      'tenant-fixture',
      todayInEstablishmentTimezone(),
    );
  });
});

describe('CompanyController service tax profile approval', () => {
  it('scopes the company before approving a service and returns the envelope', async () => {
    const { controller, companyService, serviceTaxProfiles } = makeController();
    const approve = jest.fn().mockResolvedValue(makeServiceProfile({ reviewStatus: 'approved' }));
    Object.assign(serviceTaxProfiles, { approve });
    const response = await controller.approveServiceTaxProfile(companyId, 'service-id', req);
    expect(companyService.findById).toHaveBeenCalledWith(companyId, authContext.activeTenantId, 'test');
    expect(approve).toHaveBeenCalledWith(companyId, authContext.activeTenantId, 'service-id');
    expect(response.data.reviewStatus).toBe('approved');
  });
});
