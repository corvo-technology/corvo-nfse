import {
  INITIAL_PROXY_STATE,
  advanceProxy,
  type ProxyRouteState,
} from './proxy-route.state';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 12, minute));

describe('advanceProxy', () => {
  it('stays quiet while the proxy answers', () => {
    const { state, event } = advanceProxy(INITIAL_PROXY_STATE, true, at(0));
    expect(state).toEqual(INITIAL_PROXY_STATE);
    expect(event).toBeNull();
  });

  it('reports broken only after 3 bad checks in a row, once', () => {
    let state: ProxyRouteState = INITIAL_PROXY_STATE;
    const events: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = advanceProxy(state, false, at(i));
      state = next.state;
      events.push(next.event);
    }
    expect(events.filter(Boolean)).toEqual([
      { type: 'broken', since: at(0).toISOString() },
    ]);
    expect(events[2]).not.toBeNull();
  });

  it('a good check in the middle resets the streak', () => {
    let state: ProxyRouteState = INITIAL_PROXY_STATE;
    for (const ok of [false, false, true, false, false]) {
      const next = advanceProxy(state, ok, at(0));
      state = next.state;
      expect(next.event).toBeNull();
    }
  });

  it('reports recovered once after it was broken', () => {
    let state: ProxyRouteState = INITIAL_PROXY_STATE;
    for (let i = 0; i < 3; i += 1)
      state = advanceProxy(state, false, at(i)).state;
    const back = advanceProxy(state, true, at(10));
    expect(back.event).toEqual({
      type: 'recovered',
      since: at(0).toISOString(),
      until: at(10).toISOString(),
    });
    expect(advanceProxy(back.state, true, at(11)).event).toBeNull();
  });
});
