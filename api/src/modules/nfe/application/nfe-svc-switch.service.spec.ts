import type {
  FiscalSituation,
  FiscalSituationQuery,
} from '@/modules/fiscal-core/domain/fiscal-situation';
import { NfeSvcSwitchService } from './nfe-svc-switch.service';

const OK: FiscalSituation = {
  breakerOpen: false,
  authorityReachable: true,
  network: 'ok',
};
const DOWN: FiscalSituation = {
  breakerOpen: true,
  authorityReachable: false,
  network: 'ok',
};
const NOW = new Date('2026-11-26T15:00:00Z');

function setup(opts: {
  mode?: 'none' | 'svc';
  situations?: Record<string, FiscalSituation>;
  up?: Record<string, boolean>;
  wins?: boolean;
}) {
  let mode = opts.mode ?? 'none';
  const states = {
    get: jest.fn(() =>
      Promise.resolve(
        mode === 'svc'
          ? { mode, dhCont: '2026-11-26T12:00:00-03:00', xJust: 'x' }
          : { mode, dhCont: null, xJust: null },
      ),
    ),
    enter: jest.fn(() => {
      const won = opts.wins ?? true;
      if (won) mode = 'svc';
      return Promise.resolve(won);
    }),
    exit: jest.fn(() => {
      const won = opts.wins ?? true;
      if (won) mode = 'none';
      return Promise.resolve(won);
    }),
  };
  const reader = {
    situation: jest.fn((q: FiscalSituationQuery) =>
      Promise.resolve(opts.situations?.[q.authority] ?? OK),
    ),
  };
  const status = {
    isUp: jest.fn((uf: string, tpAmb: number, tpEmis: number) =>
      Promise.resolve(opts.up?.[`${tpEmis}`] ?? true),
    ),
  };
  const announcer = {
    entered: jest.fn(() => Promise.resolve()),
    exited: jest.fn(() => Promise.resolve()),
  };
  const service = new NfeSvcSwitchService(
    states as never,
    reader as never,
    status as never,
    announcer as never,
  );
  return { service, states, reader, status, announcer };
}

describe('NfeSvcSwitchService', () => {
  describe('entering', () => {
    it('enters when only the origin is down and the SVC answers', async () => {
      const t = setup({ situations: { 'nfe-sp-2': DOWN } });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('entered');
      expect(t.states.enter).toHaveBeenCalledWith(
        'SP',
        2,
        {
          dhCont: '2026-11-26T12:00:00-03:00',
          xJust: 'SEFAZ de origem indisponivel',
        },
        NOW,
      );
      expect(t.status.isUp).toHaveBeenCalledWith('SP', 2, 6);
      expect(t.announcer.entered).toHaveBeenCalledWith({
        uf: 'SP',
        tpAmb: 2,
        authority: 'SVCAN',
        dhCont: '2026-11-26T12:00:00-03:00',
      });
    });

    it('asks the SVC-RS (tpEmis 7) for a UF served by it', async () => {
      const t = setup({ situations: { 'nfe-am-1': DOWN } });
      expect(await t.service.evaluate('AM', 1, NOW)).toBe('entered');
      expect(t.status.isUp).toHaveBeenCalledWith('AM', 1, 7);
    });

    it('does nothing while the origin looks normal', async () => {
      const t = setup({});
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
      expect(t.states.enter).not.toHaveBeenCalled();
    });

    it.each(['gov_unreachable_from_us', 'no_internet'] as const)(
      'does nothing when our own network is the problem (%s)',
      async (network) => {
        const t = setup({
          situations: { 'nfe-sp-2': { ...DOWN, network } },
        });
        expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
        expect(t.states.enter).not.toHaveBeenCalled();
        expect(t.announcer.entered).not.toHaveBeenCalled();
      },
    );

    it('does nothing when the SVC itself does not answer', async () => {
      const t = setup({
        situations: { 'nfe-sp-2': DOWN },
        up: { '6': false },
      });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
      expect(t.states.enter).not.toHaveBeenCalled();
    });

    it('does nothing when the breaker of the SVC is open', async () => {
      const t = setup({
        situations: { 'nfe-sp-2': DOWN, 'nfe-svcan-2': DOWN },
      });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
    });

    it('announces nothing when another worker already entered', async () => {
      const t = setup({ situations: { 'nfe-sp-2': DOWN }, wins: false });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
      expect(t.announcer.entered).not.toHaveBeenCalled();
    });
  });

  describe('leaving', () => {
    it('leaves when the origin is normal again and answers', async () => {
      const t = setup({ mode: 'svc' });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('exited');
      expect(t.status.isUp).toHaveBeenCalledWith('SP', 2, 1);
      expect(t.announcer.exited).toHaveBeenCalledWith(
        expect.objectContaining({ uf: 'SP', tpAmb: 2, authority: 'SVCAN' }),
      );
    });

    it('stays while the breaker of the origin is still open', async () => {
      const t = setup({ mode: 'svc', situations: { 'nfe-sp-2': DOWN } });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
      expect(t.states.exit).not.toHaveBeenCalled();
    });

    it('stays while the origin does not answer', async () => {
      const t = setup({ mode: 'svc', up: { '1': false } });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
    });

    it('announces the exit once even if two workers race', async () => {
      const t = setup({ mode: 'svc', wins: false });
      expect(await t.service.evaluate('SP', 2, NOW)).toBe('unchanged');
      expect(t.announcer.exited).not.toHaveBeenCalled();
    });
  });

  describe('forceExit', () => {
    it('leaves even though the origin still looks down, and says who did it', async () => {
      const t = setup({ mode: 'svc', situations: { 'nfe-sp-2': DOWN } });
      expect(await t.service.forceExit('SP', 2, 'ops@corvo.test', NOW)).toBe(
        true,
      );
      expect(t.announcer.exited).toHaveBeenCalledWith(
        expect.objectContaining({ by: 'ops@corvo.test' }),
      );
    });

    it('returns false when the UF is not in the SVC', async () => {
      const t = setup({ wins: false });
      expect(await t.service.forceExit('SP', 2, 'ops@corvo.test', NOW)).toBe(
        false,
      );
      expect(t.announcer.exited).not.toHaveBeenCalled();
    });
  });
});
