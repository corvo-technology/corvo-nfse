import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { TypeOrmTransactionContext } from '@/infra/persistence/typeorm/typeorm-transaction-context';
import { TypeOrmCompanyNfeSettingsRepository } from './typeorm-company-nfe-settings.repository';

const tenantId = randomUUID();
const companyId = randomUUID();

const row = (crt: number | null) => ({
  companyId,
  tenantId,
  stateRegistration: '110042490114',
  crt,
  defaultSeries: 1,
  nfceDefaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102',
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
  enabledAt: null,
});

function build(stored: ReturnType<typeof row> | null, taxRegime?: string) {
  const findProfile = jest
    .fn()
    .mockResolvedValue(taxRegime ? { taxRegime } : null);
  const manager = {
    getRepository: (entity: { name: string }) =>
      entity.name === 'CompanyNfeSettingsOrmEntity'
        ? { findOneBy: jest.fn().mockResolvedValue(stored) }
        : { findOne: findProfile },
  };
  const repo = new TypeOrmCompanyNfeSettingsRepository(
    { manager } as unknown as DataSource,
    new TypeOrmTransactionContext(),
  );
  return { repo, findProfile };
}

describe('TypeOrmCompanyNfeSettingsRepository.find', () => {
  it('has no settings before the first save', async () => {
    expect(await build(null).repo.find(companyId, tenantId)).toBeNull();
  });

  it('derives the CRT from the open fiscal profile when none is stored', async () => {
    const simples = build(row(null), 'SIMPLES_NACIONAL');
    expect((await simples.repo.find(companyId, tenantId))?.crt).toBe(1);
    expect(simples.findProfile).toHaveBeenCalledWith({
      where: expect.objectContaining({ companyId, tenantId }),
    });
    const mei = build(row(null), 'MEI');
    expect((await mei.repo.find(companyId, tenantId))?.crt).toBe(4);
  });

  it('leaves the CRT empty for a regime NF-e does not cover or a company with no profile', async () => {
    expect(
      (await build(row(null), 'LUCRO_REAL').repo.find(companyId, tenantId))
        ?.crt,
    ).toBeNull();
    expect(
      (await build(row(null)).repo.find(companyId, tenantId))?.crt,
    ).toBeNull();
  });

  it('keeps a stored override and does not read the profile', async () => {
    const { repo, findProfile } = build(row(4), 'SIMPLES_NACIONAL');
    expect((await repo.find(companyId, tenantId))?.crt).toBe(4);
    expect(findProfile).not.toHaveBeenCalled();
  });
});
