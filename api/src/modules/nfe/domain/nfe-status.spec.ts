import {
  NFE_STATUSES,
  NFE_VALID_TRANSITIONS,
  isFinalNfeStatus,
  type NfeStatus,
} from './nfe-status';
import {
  canTransitionEvent,
  canTransitionInutilization,
} from './nfe-event-status';

describe('NFE_VALID_TRANSITIONS (design spec 8.3)', () => {
  const valid: Array<[NfeStatus, NfeStatus]> = [
    ['queued', 'processing'],
    ['processing', 'authorized'],
    ['processing', 'rejected'],
    ['processing', 'denied'],
    ['processing', 'retry_pending'],
    ['processing', 'reconciliation_required'],
    ['processing', 'contingency_pending'],
    ['contingency_pending', 'processing'],
    ['retry_pending', 'processing'],
    ['reconciliation_required', 'authorized'],
    ['reconciliation_required', 'rejected'],
    ['reconciliation_required', 'denied'],
    ['reconciliation_required', 'manual_review'],
    ['manual_review', 'reconciliation_required'],
    ['manual_review', 'authorized'],
    ['manual_review', 'rejected'],
    ['authorized', 'cancelling'],
    ['cancelling', 'cancelled'],
    ['cancelling', 'authorized'],
    ['rejected', 'queued'],
    ['rejected', 'contingency_pending'],
    ['rejected', 'discarded'],
  ];

  it.each(valid)('allows %s -> %s', (from, to) => {
    expect(NFE_VALID_TRANSITIONS[from]).toContain(to);
  });

  it('allows nothing else', () => {
    const allowed = new Set(valid.map(([from, to]) => `${from}>${to}`));
    for (const from of NFE_STATUSES)
      for (const to of NFE_STATUSES)
        expect(NFE_VALID_TRANSITIONS[from].includes(to)).toBe(
          allowed.has(`${from}>${to}`),
        );
  });

  it.each([
    ['contingency_pending', 'authorized'],
    ['contingency_pending', 'rejected'],
    ['denied', 'queued'],
    ['cancelled', 'authorized'],
    ['authorized', 'rejected'],
  ] as Array<[NfeStatus, NfeStatus]>)('refuses %s -> %s', (from, to) => {
    expect(NFE_VALID_TRANSITIONS[from]).not.toContain(to);
  });

  it('has denied, cancelled and discarded as the final statuses', () => {
    expect(NFE_STATUSES.filter(isFinalNfeStatus).sort()).toEqual([
      'cancelled',
      'denied',
      'discarded',
    ]);
  });
});

describe('event and inutilization transitions', () => {
  it('follows pending -> registered | rejected | pending_check', () => {
    expect(canTransitionEvent('pending', 'registered')).toBe(true);
    expect(canTransitionEvent('pending', 'rejected')).toBe(true);
    expect(canTransitionEvent('pending', 'pending_check')).toBe(true);
    expect(canTransitionEvent('pending_check', 'pending')).toBe(true);
    expect(canTransitionEvent('pending_check', 'registered')).toBe(true);
    expect(canTransitionEvent('registered', 'pending')).toBe(false);
    expect(canTransitionEvent('rejected', 'registered')).toBe(false);
  });

  it('follows pending -> homologada | rejected for an inutilization', () => {
    expect(canTransitionInutilization('pending', 'homologada')).toBe(true);
    expect(canTransitionInutilization('pending', 'rejected')).toBe(true);
    expect(canTransitionInutilization('homologada', 'rejected')).toBe(false);
  });
});
