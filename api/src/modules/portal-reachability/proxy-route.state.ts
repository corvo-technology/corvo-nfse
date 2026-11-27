/** Bad checks in a row before the backup route is reported as broken. */
export const PROXY_BROKEN_AFTER = 3;

/** What the monitor knows about the backup proxy (checked every minute, through the proxy). */
export interface ProxyRouteState {
  /** False once a "broken" alert was raised and until it recovers. */
  working: boolean;
  badStreak: number;
  /** When the first bad check of the current streak happened (ISO). */
  since: string | null;
}

export const INITIAL_PROXY_STATE: ProxyRouteState = {
  working: true,
  badStreak: 0,
  since: null,
};

export type ProxyRouteEvent =
  | { type: 'broken'; since: string }
  | { type: 'recovered'; since: string; until: string }
  | null;

/** One check through the proxy: the next state and whether it just broke or just recovered. */
export function advanceProxy(
  state: ProxyRouteState,
  ok: boolean,
  now: Date,
): { state: ProxyRouteState; event: ProxyRouteEvent } {
  const at = now.toISOString();
  if (ok) {
    if (state.working) return { state: INITIAL_PROXY_STATE, event: null };
    return {
      state: INITIAL_PROXY_STATE,
      event: { type: 'recovered', since: state.since ?? at, until: at },
    };
  }
  const badStreak = state.badStreak + 1;
  const since = state.since ?? at;
  if (!state.working)
    return { state: { working: false, badStreak, since }, event: null };
  if (badStreak >= PROXY_BROKEN_AFTER)
    return {
      state: { working: false, badStreak, since },
      event: { type: 'broken', since },
    };
  return { state: { working: true, badStreak, since }, event: null };
}
