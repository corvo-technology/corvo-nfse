export type DpsLayoutStatus = 'published' | 'homologated' | 'in_production';

export interface DpsLayout {
  readonly id: 'rtc-v1.01';
  readonly status: DpsLayoutStatus;
}

/**
 * Layouts eligible for assembly. Only `in_production` layouts may be built;
 * anything else (unknown, `published` but not deployed, homologated only)
 * yields `DPS_LAYOUT_UNSUPPORTED`.
 */
export const ACTIVE_LAYOUTS: Record<string, DpsLayout> = {
  'rtc-v1.01': { id: 'rtc-v1.01', status: 'in_production' },
};
