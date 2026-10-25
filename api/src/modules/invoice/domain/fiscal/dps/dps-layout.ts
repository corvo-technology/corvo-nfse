export type DpsLayoutStatus = 'published' | 'homologated' | 'in_production';

export interface DpsLayout {
  readonly id: 'rtc-v1.01' | 'nt009-r1';
  readonly status: DpsLayoutStatus;
}

/** XML layout of the open-nfse library that serializes and validates each DPS layout. */
export const XML_LAYOUT: Record<DpsLayout['id'], 'v1.01' | 'nt009-r1'> = {
  'rtc-v1.01': 'v1.01',
  'nt009-r1': 'nt009-r1',
};

/**
 * Layouts eligible for assembly. Only `in_production` layouts may be built;
 * anything else (unknown, `published` but not deployed, homologated only)
 * yields `DPS_LAYOUT_UNSUPPORTED`.
 */
export const ACTIVE_LAYOUTS: Record<string, DpsLayout> = {
  'rtc-v1.01': { id: 'rtc-v1.01', status: 'in_production' },
  // NT 009 release 1: production from 2026-12-01. Selected only through FISCAL_DPS_LAYOUT.
  'nt009-r1': { id: 'nt009-r1', status: 'in_production' },
};
