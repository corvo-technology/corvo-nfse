import { CertificateExpiryScheduler } from './certificate-expiry.scheduler';

describe('CertificateExpiryScheduler', () => {
  let certRepo: {
    expireExpiredCertificates: jest.Mock;
    findExpiringSoon: jest.Mock;
  };
  let eventBus: { publishBestEffort: jest.Mock };
  let companyRepo: {
    batchRecomputeStatus: jest.Mock;
    findByIdAndTenantId: jest.Mock;
  };
  let scheduler: CertificateExpiryScheduler;

  beforeEach(() => {
    certRepo = {
      expireExpiredCertificates: jest.fn().mockResolvedValue([]),
      findExpiringSoon: jest.fn().mockResolvedValue([]),
    };
    eventBus = { publishBestEffort: jest.fn() };
    companyRepo = {
      batchRecomputeStatus: jest.fn().mockResolvedValue(undefined),
      findByIdAndTenantId: jest
        .fn()
        .mockResolvedValue({ tradeName: null, legalName: 'Acme Ltda' }),
    };
    scheduler = new CertificateExpiryScheduler(
      {
        visit: async (_kind: string, work: (id: string) => Promise<void>) =>
          work('tenant-1'),
      } as never,
      certRepo as any,
      companyRepo as any,
      eventBus as never,
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

  it('warns 30 days ahead, and 7 days ahead once it is closer', async () => {
    const day = 86_400_000;
    certRepo.findExpiringSoon.mockResolvedValue([
      {
        companyId: 'far',
        companyName: 'Longe',
        validUntil: new Date(Date.now() + 20 * day),
      },
      {
        companyId: 'near',
        companyName: 'Perto',
        validUntil: new Date(Date.now() + 3 * day),
      },
    ]);

    await scheduler.handleExpiry();

    const stages = (
      eventBus.publishBestEffort.mock.calls as unknown as Array<
        [{ notice: { companyId: string; stage: string } }]
      >
    ).map(([event]) => [event.notice.companyId, event.notice.stage]);
    expect(stages).toEqual([
      ['far', 30],
      ['near', 7],
    ]);
  });

  it('announces a live company whose certificate just expired', async () => {
    certRepo.expireExpiredCertificates.mockResolvedValue(['c1']);

    await scheduler.handleExpiry();

    expect(eventBus.publishBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        notice: expect.objectContaining({
          companyName: 'Acme Ltda',
          stage: 0,
        }),
      }),
    );
  });
});
