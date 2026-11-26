import type { PortalHealth } from './reachability.classifier';

/** Bad checks in a row before the alert opens, and good ones before it closes. */
export const OPEN_AFTER = 3;
export const CLOSE_AFTER = 2;

export interface ReachabilityState {
  phase: 'ok' | 'incident';
  /** What the current incident (or the current bad streak) is. */
  health: PortalHealth;
  /** When the first bad check of the incident happened (ISO). */
  since: string | null;
  badStreak: number;
  goodStreak: number;
  lastCheckAt: string | null;
}

export const INITIAL_STATE: ReachabilityState = {
  phase: 'ok',
  health: 'ok',
  since: null,
  badStreak: 0,
  goodStreak: 0,
  lastCheckAt: null,
};

export type ReachabilityEvent =
  | { type: 'opened'; health: PortalHealth; since: string }
  | { type: 'closed'; health: PortalHealth; since: string; until: string }
  | null;

/** One check: returns the next state and whether an incident opened or closed. */
export function advance(
  state: ReachabilityState,
  health: PortalHealth,
  now: Date,
): { state: ReachabilityState; event: ReachabilityEvent } {
  const at = now.toISOString();
  if (health !== 'ok') {
    const badStreak = state.badStreak + 1;
    const since = state.since ?? at;
    if (state.phase === 'incident')
      return {
        state: { ...state, health, goodStreak: 0, badStreak, lastCheckAt: at },
        event: null,
      };
    const next: ReachabilityState = {
      phase: badStreak >= OPEN_AFTER ? 'incident' : 'ok',
      health,
      since,
      badStreak,
      goodStreak: 0,
      lastCheckAt: at,
    };
    return {
      state: next,
      event:
        next.phase === 'incident' ? { type: 'opened', health, since } : null,
    };
  }
  if (state.phase === 'incident') {
    const goodStreak = state.goodStreak + 1;
    if (goodStreak >= CLOSE_AFTER)
      return {
        state: { ...INITIAL_STATE, lastCheckAt: at },
        event: {
          type: 'closed',
          health: state.health,
          since: state.since ?? at,
          until: at,
        },
      };
    return {
      state: { ...state, goodStreak, lastCheckAt: at },
      event: null,
    };
  }
  return { state: { ...INITIAL_STATE, lastCheckAt: at }, event: null };
}
