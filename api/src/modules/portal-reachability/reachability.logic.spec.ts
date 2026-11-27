import {
  classifyProbes,
  isOurSide,
  type PortalHealth,
} from './reachability.classifier';
import {
  advance,
  CLOSE_AFTER,
  INITIAL_STATE,
  OPEN_AFTER,
  type ReachabilityState,
} from './reachability.state';

const up = { sefin: true, adn: true, govControl: true, externalControl: true };

describe('classifyProbes', () => {
  it('is ok when both NFS-e hosts answer', () => {
    expect(classifyProbes(up)).toBe('ok');
    expect(classifyProbes({ ...up, govControl: false })).toBe('ok');
  });

  it('says the portal is down when the government network answers but an NFS-e host does not', () => {
    expect(classifyProbes({ ...up, sefin: false, adn: false })).toBe(
      'portal_down',
    );
    expect(classifyProbes({ ...up, sefin: false })).toBe('portal_down');
  });

  it('says it is our network when every government host fails but the outside control works', () => {
    expect(
      classifyProbes({
        sefin: false,
        adn: false,
        govControl: false,
        externalControl: true,
      }),
    ).toBe('gov_unreachable_from_us');
  });

  it('says no internet when everything fails', () => {
    expect(
      classifyProbes({
        sefin: false,
        adn: false,
        govControl: false,
        externalControl: false,
      }),
    ).toBe('no_internet');
  });

  it('says the portal is down when a SEFAZ answers but the NFS-e hosts and the gov control do not', () => {
    const govBlocked = {
      sefin: false,
      adn: false,
      govControl: false,
      externalControl: true,
    };
    expect(
      classifyProbes({ ...govBlocked, authorities: { 'nfe-sp-2': true } }),
    ).toBe('portal_down');
    expect(
      classifyProbes({
        ...govBlocked,
        authorities: { 'nfe-sp-2': false, 'nfce-sp-2': true },
      }),
    ).toBe('portal_down');
  });

  it('keeps the old answers when no SEFAZ answers or none is probed', () => {
    const govBlocked = {
      sefin: false,
      adn: false,
      govControl: false,
      externalControl: true,
    };
    expect(classifyProbes({ ...govBlocked, authorities: {} })).toBe(
      'gov_unreachable_from_us',
    );
    expect(
      classifyProbes({ ...govBlocked, authorities: { 'nfe-sp-2': false } }),
    ).toBe('gov_unreachable_from_us');
    expect(
      classifyProbes({
        ...govBlocked,
        externalControl: false,
        authorities: { 'nfe-sp-2': false },
      }),
    ).toBe('no_internet');
    expect(classifyProbes({ ...up, authorities: { 'nfe-sp-2': false } })).toBe(
      'ok',
    );
  });

  it('knows which classifications are on our side', () => {
    expect(isOurSide('gov_unreachable_from_us')).toBe(true);
    expect(isOurSide('no_internet')).toBe(true);
    expect(isOurSide('emission_failures')).toBe(true);
    expect(isOurSide('portal_down')).toBe(false);
    expect(isOurSide('ok')).toBe(false);
  });
});

describe('advance (hysteresis)', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 12, minute));
  const run = (healths: PortalHealth[]) => {
    let state: ReachabilityState = INITIAL_STATE;
    const events: Array<ReturnType<typeof advance>['event']> = [];
    healths.forEach((health, minute) => {
      const next = advance(state, health, at(minute));
      state = next.state;
      events.push(next.event);
    });
    return { state, events };
  };

  it('opens only after the third bad check in a row, with the time of the first one', () => {
    const { state, events } = run([
      'no_internet',
      'no_internet',
      'no_internet',
    ]);
    expect(OPEN_AFTER).toBe(3);
    expect(events.slice(0, 2)).toEqual([null, null]);
    expect(events[2]).toEqual({
      type: 'opened',
      health: 'no_internet',
      since: at(0).toISOString(),
    });
    expect(state.phase).toBe('incident');
  });

  it('forgets a short bad streak', () => {
    const { state, events } = run([
      'portal_down',
      'portal_down',
      'ok',
      'portal_down',
      'portal_down',
    ]);
    expect(events.every((event) => event === null)).toBe(true);
    expect(state.phase).toBe('ok');
  });

  it('opens once per incident, not at every bad check', () => {
    const { events } = run(
      Array<PortalHealth>(8).fill('gov_unreachable_from_us'),
    );
    expect(events.filter((event) => event?.type === 'opened')).toHaveLength(1);
  });

  it('closes only after two good checks and reports the duration of the incident', () => {
    const { state, events } = run([
      'portal_down',
      'portal_down',
      'portal_down',
      'portal_down',
      'ok',
      'portal_down',
      'ok',
      'ok',
    ]);
    expect(CLOSE_AFTER).toBe(2);
    // one good check followed by a bad one does not close
    expect(events[4]).toBeNull();
    expect(events[6]).toBeNull();
    expect(events[7]).toEqual({
      type: 'closed',
      health: 'portal_down',
      since: at(0).toISOString(),
      until: at(7).toISOString(),
    });
    expect(state).toMatchObject({ phase: 'ok', badStreak: 0, since: null });
  });

  it('follows a change of classification inside one incident without a new alert', () => {
    const { state, events } = run([
      'portal_down',
      'portal_down',
      'portal_down',
      'gov_unreachable_from_us',
    ]);
    expect(events[3]).toBeNull();
    expect(state.health).toBe('gov_unreachable_from_us');
    expect(state.since).toBe(at(0).toISOString());
  });
});
