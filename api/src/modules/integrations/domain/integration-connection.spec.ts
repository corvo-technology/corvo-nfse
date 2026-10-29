import {
  InvalidConnectionTransitionError,
  transitionState,
} from './integration-connection';

describe('connection state machine', () => {
  it.each([
    ['draft', 'active'],
    ['active', 'paused'],
    ['paused', 'active'],
    ['active', 'reauth_required'],
    ['paused', 'reauth_required'],
    ['reauth_required', 'active'],
    ['paused', 'disconnected'],
    ['draft', 'disconnected'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(transitionState(from, to)).toBe(to);
  });

  it.each([
    ['draft', 'paused'],
    ['disconnected', 'active'],
    ['draft', 'reauth_required'],
    ['active', 'draft'],
  ] as const)('refuses %s -> %s', (from, to) => {
    expect(() => transitionState(from, to)).toThrow(
      InvalidConnectionTransitionError,
    );
  });
});
