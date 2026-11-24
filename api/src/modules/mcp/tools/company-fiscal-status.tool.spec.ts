import 'reflect-metadata';
import { CompanyNotFoundError } from '@/modules/company/domain/errors';
import { createCompanyFiscalStatusHandler } from './company-fiscal-status.tool';

const ID = '4f6e2b0a-8a52-4d0e-9a3e-1c2b3d4e5f60';
const ctx = { activeTenantId: 'tenant-1', tenantId: 'tenant-1' } as never;

function build(overrides: { findById?: jest.Mock; certs?: unknown[] } = {}) {
  const company = {
    id: ID,
    toSnapshot: () => ({
      id: ID,
      legalName: 'Corvo',
      taxId: '11222333000181',
      municipalityCode: '3550308',
      status: 'ready',
    }),
  };
  const deps = {
    companies: {
      findById: overrides.findById ?? jest.fn().mockResolvedValue(company),
      findByTaxId: jest.fn().mockResolvedValue(company),
    },
    fiscalProfiles: {
      current: jest.fn().mockResolvedValue({ taxRegime: 'MEI' }),
    },
    serviceTaxProfiles: { list: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
    certificates: {
      listByCompany: jest.fn().mockResolvedValue(
        overrides.certs ?? [
          {
            id: 'c1',
            subject: 'CN=Corvo',
            validFrom: new Date('2024-01-01'),
            validUntil: new Date('2099-01-01'),
            status: 'active',
            fingerprint: 'abc',
          },
        ],
      ),
    },
    dpsSequences: {
      current: jest.fn().mockResolvedValue({ series: '1', lastNumber: 42 }),
    },
  };
  const handler = createCompanyFiscalStatusHandler(
    deps.companies,
    deps.fiscalProfiles,
    deps.serviceTaxProfiles,
    deps.certificates,
    deps.dpsSequences,
  );
  return { deps, handler };
}

describe('company_fiscal_status tool', () => {
  it('returns profile, tax profiles, certificate status and DPS number', async () => {
    const { deps, handler } = build();
    const result = await handler({ company_id: ID }, ctx);
    expect(deps.companies.findById).toHaveBeenCalledWith(
      ID,
      'tenant-1',
      expect.anything(),
    );
    expect(result).toMatchObject({
      company: { id: ID, tax_id: '11222333000181' },
      fiscal_profile: { taxRegime: 'MEI' },
      service_tax_profiles: [{ id: 'p1' }],
      certificates: [{ id: 'c1', status: 'active', expired: false }],
      dps_sequence: { series: '1', last_number: 42 },
    });
  });

  it('never exposes certificate secrets and flags an expired certificate', async () => {
    const { handler } = build({
      certs: [
        {
          id: 'c1',
          subject: 'CN=Corvo',
          validFrom: new Date('2020-01-01'),
          validUntil: new Date('2021-01-01'),
          status: 'active',
          fingerprint: 'abc',
          pfx: 'SECRET',
          password: 'SECRET',
        },
      ],
    });
    const result = await handler({ tax_id: '11.222.333/0001-81' }, ctx);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.certificates[0]).toMatchObject({ expired: true });
  });

  it('propagates not-found when the company is not in the workspace', async () => {
    const { handler } = build({
      findById: jest.fn().mockRejectedValue(new CompanyNotFoundError(ID)),
    });
    await expect(handler({ company_id: ID }, ctx)).rejects.toThrow(
      `Company not found: ${ID}`,
    );
  });

  it('requires company_id or tax_id', async () => {
    const { handler } = build();
    await expect(handler({}, ctx)).rejects.toThrow(
      /company_id or tax_id is required/,
    );
  });
});
