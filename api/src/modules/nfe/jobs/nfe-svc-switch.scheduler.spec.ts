import { NfeSvcSwitchScheduler } from './nfe-svc-switch.scheduler';

const NOW = new Date('2026-11-26T15:00:00Z');

function setup(opts: {
  targets?: { uf: string; tpAmb: 1 | 2 }[];
  active?: { uf: string; tpAmb: 1 | 2 }[];
  production?: boolean;
}) {
  const service = {
    evaluate: jest.fn(() => Promise.resolve('unchanged')),
    clearSilently: jest.fn(() => Promise.resolve(true)),
  };
  const audience = {
    monitoredTargets: jest.fn((_production: boolean) =>
      Promise.resolve(opts.targets ?? []),
    ),
  };
  const scheduler = new NfeSvcSwitchScheduler(
    service as never,
    { listActive: jest.fn(() => Promise.resolve(opts.active ?? [])) } as never,
    { get: () => opts.production ?? false } as never,
    audience as never,
  );
  return { service, audience, scheduler };
}

const evaluated = (service: { evaluate: jest.Mock }) =>
  service.evaluate.mock.calls.map((c) => (c as unknown[]).slice(0, 2));

describe('NfeSvcSwitchScheduler', () => {
  it('watches nothing when no company has NF-e settings', async () => {
    const { service, scheduler } = setup({});
    await scheduler.run(NOW);
    expect(service.evaluate).not.toHaveBeenCalled();
  });

  it('a company in PE only makes PE a target', async () => {
    const { service, scheduler } = setup({ targets: [{ uf: 'PE', tpAmb: 1 }] });
    await scheduler.run(NOW);
    expect(evaluated(service)).toEqual([['PE', 1]]);
    expect(service.evaluate).toHaveBeenCalledWith('PE', 1, NOW);
  });

  it('passes the production switch to the target query', async () => {
    const { audience, scheduler } = setup({ production: true });
    await scheduler.run(NOW);
    expect(audience.monitoredTargets).toHaveBeenCalledWith(true);
  });

  it('keeps SP: an SP company is evaluated', async () => {
    const { service, scheduler } = setup({ targets: [{ uf: 'SP', tpAmb: 2 }] });
    await scheduler.run(NOW);
    expect(evaluated(service)).toEqual([['SP', 2]]);
  });

  it('clears quietly a UF stuck in the SVC that no company uses, and does not evaluate it', async () => {
    const { service, scheduler } = setup({
      targets: [{ uf: 'PE', tpAmb: 1 }],
      active: [
        { uf: 'GO', tpAmb: 2 },
        { uf: 'PE', tpAmb: 1 },
      ],
    });
    await scheduler.run(NOW);
    expect(service.clearSilently).toHaveBeenCalledTimes(1);
    expect(service.clearSilently).toHaveBeenCalledWith('GO', 2, NOW);
    expect(evaluated(service)).toEqual([['PE', 1]]);
  });

  it('keeps going when one UF fails', async () => {
    const { service, scheduler } = setup({
      targets: [
        { uf: 'SP', tpAmb: 2 },
        { uf: 'PE', tpAmb: 2 },
      ],
    });
    service.evaluate.mockRejectedValueOnce(new Error('redis down'));
    await expect(scheduler.run(NOW)).resolves.toBeUndefined();
    expect(service.evaluate).toHaveBeenCalledTimes(2);
  });
});
