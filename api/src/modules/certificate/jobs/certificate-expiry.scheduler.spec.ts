import { CertificateExpiryScheduler } from './certificate-expiry.scheduler';

describe('CertificateExpiryScheduler', () => {
  let certRepo: { expireExpiredCertificates: jest.Mock };
  let companyRepo: { batchRecomputeStatus: jest.Mock };
  let scheduler: CertificateExpiryScheduler;

  beforeEach(() => {
    certRepo = { expireExpiredCertificates: jest.fn().mockResolvedValue([]) };
    companyRepo = {
      batchRecomputeStatus: jest.fn().mockResolvedValue(undefined),
    };
    scheduler = new CertificateExpiryScheduler(
      {
        visit: async (_kind: string, work: (id: string) => Promise<void>) =>
          work('tenant-1'),
      } as never,
      certRepo as any,
      companyRepo as any,
    );
  });

  it('marks expired certificates and recomputes affected companies in batch', async () => {
    certRepo.expireExpiredCertificates.mockResolvedValue(['c1', 'c2', 'c3']);

    await scheduler.handleExpiry();

    expect(certRepo.expireExpiredCertificates).toHaveBeenCalledTimes(1);
    expect(companyRepo.batchRecomputeStatus).toHaveBeenCalledWith(
      ['c1', 'c2', 'c3'],
      'tenant-1',
    );
  });

  it('does not call batchRecomputeStatus when no certificates expired', async () => {
    certRepo.expireExpiredCertificates.mockResolvedValue([]);

    await scheduler.handleExpiry();

    expect(certRepo.expireExpiredCertificates).toHaveBeenCalledTimes(1);
    expect(companyRepo.batchRecomputeStatus).not.toHaveBeenCalled();
  });
});
