import { CompanyCertificateReader } from './company-certificate-reader';

describe('CompanyCertificateReader.activeCertificateCounts', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it('asks for every company in one query, not one per company', async () => {
    const certRepo = {
      findActiveByCompanyId: jest.fn(),
      findActiveByCompanyIds: jest.fn().mockResolvedValue([
        { companyId: 'a', validUntil: future },
        { companyId: 'b', validUntil: past },
      ]),
    };
    const reader = new CompanyCertificateReader(certRepo as never);

    const result = await reader.activeCertificateCounts(
      ['a', 'b', 'c'],
      'live',
      'tenant-1',
    );

    expect(certRepo.findActiveByCompanyIds).toHaveBeenCalledTimes(1);
    expect(certRepo.findActiveByCompanyIds).toHaveBeenCalledWith(
      ['a', 'b', 'c'],
      'tenant-1',
      'live',
    );
    expect(certRepo.findActiveByCompanyId).not.toHaveBeenCalled();
    expect(Object.fromEntries(result)).toEqual({ a: true, b: false, c: false });
  });
});
