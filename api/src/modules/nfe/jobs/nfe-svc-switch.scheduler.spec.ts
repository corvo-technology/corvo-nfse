import { NfeSvcSwitchScheduler } from './nfe-svc-switch.scheduler';

const NOW = new Date('2026-11-26T15:00:00Z');

function setup(
  enabled: { uf: string; model: 55 | 65; tpAmb: 1 | 2 }[],
  active: { uf: string; tpAmb: 1 | 2 }[] = [],
) {
  const service = { evaluate: jest.fn(() => Promise.resolve('unchanged')) };
  const scheduler = new NfeSvcSwitchScheduler(
    service as never,
    { listActive: jest.fn(() => Promise.resolve(active)) } as never,
    { listEnabled: jest.fn(() => Promise.resolve(enabled)) } as never,
  );
  return { service, scheduler };
}

describe('NfeSvcSwitchScheduler', () => {
  it('evaluates every released NF-e UF and environment, once, and skips the NFC-e', async () => {
    const { service, scheduler } = setup([
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'SP', model: 65, tpAmb: 2 },
      { uf: 'AM', model: 55, tpAmb: 1 },
    ]);
    await scheduler.run(NOW);
    expect(service.evaluate.mock.calls).toEqual([
      ['SP', 2, NOW],
      ['AM', 1, NOW],
    ]);
  });

  it('also evaluates a UF that is in the SVC but lost its release, so it can leave', async () => {
    const { service, scheduler } = setup([], [{ uf: 'MG', tpAmb: 2 }]);
    await scheduler.run(NOW);
    expect(service.evaluate).toHaveBeenCalledWith('MG', 2, NOW);
  });

  it('ignores an unknown UF and keeps going when one UF fails', async () => {
    const { service, scheduler } = setup([
      { uf: 'XX', model: 55, tpAmb: 2 },
      { uf: 'SP', model: 55, tpAmb: 2 },
      { uf: 'RJ', model: 55, tpAmb: 2 },
    ]);
    service.evaluate.mockRejectedValueOnce(new Error('redis down'));
    await expect(scheduler.run(NOW)).resolves.toBeUndefined();
    expect(service.evaluate.mock.calls.map((c) => (c as unknown[])[0])).toEqual(
      ['SP', 'RJ'],
    );
  });
});
