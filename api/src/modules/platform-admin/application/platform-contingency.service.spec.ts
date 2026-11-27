import { NotFoundException } from '@nestjs/common';
import { PlatformContingencyService } from './platform-contingency.service';

const actor = { authUserId: 'u1', email: 'admin@corvo.test', ipHash: 'h' };

function setup(mode: 'none' | 'svc', exitWins = true) {
  const states = {
    get: jest.fn(() => Promise.resolve({ mode, dhCont: null, xJust: null })),
    listActive: jest.fn(() =>
      Promise.resolve([
        {
          uf: 'SP',
          tpAmb: 2,
          enteredAt: new Date('2026-11-26T15:00:00Z'),
          dhCont: '2026-11-26T12:00:00-03:00',
        },
      ]),
    ),
  };
  const switcher = { forceExit: jest.fn(() => Promise.resolve(exitWins)) };
  const audit = { insert: jest.fn(() => Promise.resolve({})) };
  const service = new PlatformContingencyService(
    states as never,
    switcher as never,
    audit as never,
  );
  return { service, states, switcher, audit };
}

describe('PlatformContingencyService', () => {
  it('lists the UFs in the SVC with the authority of each', async () => {
    const { service } = setup('svc');
    expect(await service.list()).toEqual([
      {
        uf: 'SP',
        tpAmb: 2,
        authority: 'SVCAN',
        enteredAt: '2026-11-26T15:00:00.000Z',
        dhCont: '2026-11-26T12:00:00-03:00',
      },
    ]);
  });

  it('audits and leaves the SVC', async () => {
    const { service, switcher, audit } = setup('svc');
    expect(await service.forceExit(actor, 'sp', 2, 'SEFAZ voltou')).toEqual({
      uf: 'SP',
      tpAmb: 2,
      mode: 'none',
    });
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'svc_forced_exit',
        reason: 'SEFAZ voltou',
        payload: { uf: 'SP', tpAmb: 2 },
        success: true,
      }),
    );
    expect(switcher.forceExit).toHaveBeenCalledWith(
      'SP',
      2,
      'admin@corvo.test',
    );
  });

  it('is a 404 for a UF that is not in the SVC, and writes nothing', async () => {
    const { service, switcher, audit } = setup('none');
    await expect(
      service.forceExit(actor, 'SP', 2, 'sem contingência'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.insert).not.toHaveBeenCalled();
    expect(switcher.forceExit).not.toHaveBeenCalled();
  });

  it('is a 404 for an unknown UF', async () => {
    const { service } = setup('svc');
    await expect(
      service.forceExit(actor, 'XX', 2, 'não existe'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not leave the SVC when the audit cannot be written', async () => {
    const { service, switcher, audit } = setup('svc');
    audit.insert.mockRejectedValueOnce(new Error('db'));
    await expect(
      service.forceExit(actor, 'SP', 2, 'sem auditoria'),
    ).rejects.toThrow('db');
    expect(switcher.forceExit).not.toHaveBeenCalled();
  });
});
