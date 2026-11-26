/** Cancellation (110111) and correction letter (110110) events. Design spec 8.3. */
export type NfeEventStatus =
  'pending' | 'pending_check' | 'registered' | 'rejected';

export const NFE_EVENT_TRANSITIONS: Record<NfeEventStatus, NfeEventStatus[]> = {
  pending: ['registered', 'rejected', 'pending_check'],
  pending_check: ['registered', 'rejected', 'pending'],
  registered: [],
  rejected: [],
};

/** Inutilization of a number range. A timeout is answered by consulting and resending the same request. */
export type NfeInutilizationStatus = 'pending' | 'homologada' | 'rejected';

export const NFE_INUTILIZATION_TRANSITIONS: Record<
  NfeInutilizationStatus,
  NfeInutilizationStatus[]
> = {
  pending: ['homologada', 'rejected'],
  homologada: [],
  rejected: [],
};

export function canTransitionEvent(
  from: NfeEventStatus,
  to: NfeEventStatus,
): boolean {
  return NFE_EVENT_TRANSITIONS[from].includes(to);
}

export function canTransitionInutilization(
  from: NfeInutilizationStatus,
  to: NfeInutilizationStatus,
): boolean {
  return NFE_INUTILIZATION_TRANSITIONS[from].includes(to);
}
