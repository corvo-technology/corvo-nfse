import type { FiscalPortalBreaker } from '@/modules/invoice/application/fiscal-portal-breaker';
import type { AuthorityReachabilityStore } from './authority-reachability.store';
import { FiscalSituationReaderImpl } from './fiscal-situation.reader';
import type { PortalReachabilityStore } from './reachability.store';

const query = { authority: 'nfe-sp-2', environment: 'test' } as const;

function build(parts: {
  breaker?: () => Promise<{ available: boolean }>;
  probe?: () => Promise<{ reachable: boolean } | null>;
  network?: () => Promise<{ state: string }>;
}) {
  const status = jest.fn(parts.breaker ?? (async () => ({ available: true })));
  const reader = new FiscalSituationReaderImpl(
    { status } as unknown as FiscalPortalBreaker,
    {
      get: parts.probe ?? (async () => null),
    } as unknown as AuthorityReachabilityStore,
    {
      current: parts.network ?? (async () => ({ state: 'ok' })),
    } as unknown as PortalReachabilityStore,
  );
  return { reader, status };
}

const down = () => Promise.reject(new Error('redis down'));

describe('FiscalSituationReaderImpl', () => {
  it('reads the breaker of that authority, its probe and the connection state', async () => {
    const { reader, status } = build({
      breaker: async () => ({ available: false }),
      probe: async () => ({ reachable: false }),
      network: async () => ({ state: 'portal_down' }),
    });
    expect(await reader.situation(query)).toEqual({
      breakerOpen: true,
      authorityReachable: false,
      network: 'portal_down',
    });
    expect(status).toHaveBeenCalledWith('test', 'nfe-sp-2');
  });

  it('is neutral when Redis fails on every read', async () => {
    const { reader } = build({ breaker: down, probe: down, network: down });
    expect(await reader.situation(query)).toEqual({
      breakerOpen: false,
      authorityReachable: null,
      network: 'ok',
    });
  });

  it('keeps the signals that could be read when one fails', async () => {
    const { reader } = build({
      breaker: down,
      probe: async () => ({ reachable: true }),
      network: async () => ({ state: 'gov_unreachable_from_us' }),
    });
    expect(await reader.situation(query)).toEqual({
      breakerOpen: false,
      authorityReachable: true,
      network: 'gov_unreachable_from_us',
    });
  });
});
