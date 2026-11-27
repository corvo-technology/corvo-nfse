import { adviseContingency, type FiscalSituation } from './fiscal-situation';

const calm: FiscalSituation = {
  breakerOpen: false,
  authorityReachable: true,
  network: 'ok',
};

describe('adviseContingency', () => {
  it.each<[string, Partial<FiscalSituation>, string]>([
    ['everything fine', {}, 'normal'],
    ['never probed', { authorityReachable: null }, 'normal'],
    ['emission failures alone', { network: 'emission_failures' }, 'normal'],
    ['portal down alone', { network: 'portal_down' }, 'normal'],
    ['breaker open', { breakerOpen: true }, 'authority_down'],
    ['probe fails', { authorityReachable: false }, 'authority_down'],
    [
      'no government host answers',
      { network: 'gov_unreachable_from_us' },
      'our_network',
    ],
    ['nothing answers', { network: 'no_internet' }, 'no_internet'],
  ])('%s', (_name, change, expected) => {
    expect(adviseContingency({ ...calm, ...change })).toBe(expected);
  });

  it('puts no_internet before our_network before authority_down', () => {
    const bad = { breakerOpen: true, authorityReachable: false };
    expect(
      adviseContingency({ ...bad, network: 'gov_unreachable_from_us' }),
    ).toBe('our_network');
    expect(adviseContingency({ ...bad, network: 'no_internet' })).toBe(
      'no_internet',
    );
  });
});
