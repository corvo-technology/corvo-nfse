import { MunicipalityAgreementService } from './municipality-agreement.service';
import type { MunicipalityAgreementAnswer } from '../domain/municipality-agreement';

const answer: MunicipalityAgreementAnswer = {
  municipalityCode: '3550308',
  found: true,
  agreementType: '1',
  nationalEnvironment: '0',
};

function build(
  stored: {
    answer: MunicipalityAgreementAnswer;
    checkedAt: Date;
  } | null = null,
) {
  const companies = {
    findByIdAndTenantId: jest.fn().mockResolvedValue({
      toSnapshot: () => ({ municipalityCode: '3550308' }),
    }),
    findMunicipalityAgreement: jest.fn().mockResolvedValue(stored),
    saveMunicipalityAgreement: jest.fn().mockResolvedValue(undefined),
  };
  const sefin = { lookup: jest.fn().mockResolvedValue(answer) };
  const certificates = {
    decryptCredentials: jest
      .fn()
      .mockResolvedValue({ pfxBuffer: Buffer.from('p'), password: 'x' }),
  };
  const service = new MunicipalityAgreementService(
    companies as never,
    sefin,
    certificates as never,
  );
  return { service, companies, sefin, certificates };
}

describe('MunicipalityAgreementService', () => {
  it('asks the Sefin and stores the answer', async () => {
    const { service, sefin, companies } = build();
    const result = await service.refresh('c1', 't1', 'live');
    expect(sefin.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        municipalityCode: '3550308',
        environment: 'live',
      }),
    );
    expect(companies.saveMunicipalityAgreement).toHaveBeenCalledWith(
      'c1',
      't1',
      answer,
      expect.any(Date),
    );
    expect(result?.answer).toEqual(answer);
  });

  it('does not throw and keeps the old answer when the lookup fails', async () => {
    const old = { answer, checkedAt: new Date('2026-01-01') };
    const { service, sefin, companies } = build(old);
    sefin.lookup.mockRejectedValue(new Error('network'));
    await expect(service.refresh('c1', 't1', 'live')).resolves.toEqual(old);
    expect(companies.saveMunicipalityAgreement).not.toHaveBeenCalled();
  });

  it('does not throw without a certificate', async () => {
    const { service, certificates, sefin } = build();
    certificates.decryptCredentials.mockRejectedValue(new Error('no cert'));
    await expect(service.refresh('c1', 't1', 'test')).resolves.toBeNull();
    expect(sefin.lookup).not.toHaveBeenCalled();
  });

  it('view without certificate is "not checked" and never calls the Sefin', async () => {
    const { service, sefin } = build();
    const view = await service.view('c1', 't1', 'test', false, '3550308');
    expect(view.status).toBe('not_checked');
    expect(sefin.lookup).not.toHaveBeenCalled();
  });

  it('view reuses an answer younger than 24h', async () => {
    const { service, sefin } = build({ answer, checkedAt: new Date() });
    const view = await service.view('c1', 't1', 'live', true, '3550308');
    expect(view.status).toBe('inactive');
    expect(sefin.lookup).not.toHaveBeenCalled();
  });

  it('view asks again when the answer is older than 24h', async () => {
    const { service, sefin } = build({
      answer,
      checkedAt: new Date(Date.now() - 25 * 3600_000),
    });
    await service.view('c1', 't1', 'live', true, '3550308');
    expect(sefin.lookup).toHaveBeenCalledTimes(1);
  });

  it('view asks again when the company changed municipality', async () => {
    const { service, sefin } = build({ answer, checkedAt: new Date() });
    await service.view('c1', 't1', 'live', true, '3304557');
    expect(sefin.lookup).toHaveBeenCalledTimes(1);
  });
});
