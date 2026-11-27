import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';

/**
 * What the connection monitor says about the way to the government. A copy of the labels of
 * `modules/portal-reachability` (fiscal-core does not import that module).
 */
export type PortalHealth =
  | 'ok'
  | 'portal_down'
  | 'gov_unreachable_from_us'
  | 'no_internet'
  | 'emission_failures';

/** The three signals about one authority, read together. */
export interface FiscalSituation {
  /** The circuit breaker of the authority is open (calls are paused). */
  breakerOpen: boolean;
  /** The last TCP probe of the authority's host; null when it was never probed or is unknown. */
  authorityReachable: boolean | null;
  /** The classification of the whole connection to the government. */
  network: PortalHealth;
}

/**
 * Whose problem it is, which decides what helps:
 * - `normal`: nothing to do;
 * - `authority_down`: this SEFAZ is out while the rest answers (SVC, off-line);
 * - `our_network`: no government host answers us (SVC and EPEC do not help: they are government hosts);
 * - `no_internet`: nothing answers.
 */
export type ContingencyAdvice =
  'normal' | 'authority_down' | 'our_network' | 'no_internet';

export function adviseContingency(s: FiscalSituation): ContingencyAdvice {
  if (s.network === 'no_internet') return 'no_internet';
  if (s.network === 'gov_unreachable_from_us') return 'our_network';
  if (s.breakerOpen || s.authorityReachable === false) return 'authority_down';
  return 'normal';
}

export interface FiscalSituationQuery {
  /** Breaker/probe name: `nfe-sp-2`, `nfce-sp-2`, `nfe-svcan-2`. */
  authority: string;
  environment: ExecutionEnvironment;
}

export interface FiscalSituationReader {
  /** Never throws: a failed read counts as "nothing wrong" (`false`, `null`, `'ok'`). */
  situation(q: FiscalSituationQuery): Promise<FiscalSituation>;
}

export const FISCAL_SITUATION_READER = Symbol('FISCAL_SITUATION_READER');
