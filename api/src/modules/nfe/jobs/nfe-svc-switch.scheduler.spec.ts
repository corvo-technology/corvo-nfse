import { NfeSvcSwitchScheduler } from './nfe-svc-switch.scheduler';

const NOW = new Date('2026-11-26T15:00:00Z');

function setup(
  active: { uf: string; tpAmb: 1 | 2 }[] = [],
  production = false,
) {
  const service = { evaluate: jest.fn(() => Promise.resolve('unchanged')) };
  const scheduler = new NfeSvcSwitchScheduler(
    service as never,
    { listActive: jest.fn(() => Promise.resolve(active)) } as never,
    { get: () => production } as never,
  );
  return { service, scheduler };
}

const evaluated = (service: { evaluate: jest.Mock }) =>
  service.evaluate.mock.calls.map((c) => (c as unknown[]).slice(0, 2));

describe('NfeSvcSwitchScheduler', () => {
  it('evaluates every UF the code supports in homologação, once, with nothing to release', async () => {
    const { service, scheduler } = setup();
    await scheduler.run(NOW);
    const calls = evaluated(service);
    expect(calls).toHaveLength(27);
    expect(calls).toContainEqual(['SP', 2]);
    expect(calls).toContainEqual(['AM', 2]);
    expect(calls.some((c) => c[1] === 1)).toBe(false);
    expect(service.evaluate).toHaveBeenCalledWith('SP', 2, NOW);
  });

  it('evaluates production too when it is switched on', async () => {
    const { service, scheduler } = setup([], true);
    await scheduler.run(NOW);
    expect(evaluated(service)).toHaveLength(54);
    expect(evaluated(service)).toContainEqual(['SP', 1]);
  });

  it('also evaluates a UF that is in the SVC in an environment no longer listed, so it can leave', async () => {
    const { service, scheduler } = setup([{ uf: 'MG', tpAmb: 1 }]);
    await scheduler.run(NOW);
    expect(service.evaluate).toHaveBeenCalledWith('MG', 1, NOW);
  });

  it('keeps going when one UF fails', async () => {
    const { service, scheduler } = setup();
    service.evaluate.mockRejectedValueOnce(new Error('redis down'));
    await expect(scheduler.run(NOW)).resolves.toBeUndefined();
    expect(service.evaluate).toHaveBeenCalledTimes(27);
  });
});
