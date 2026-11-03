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
  // Production requires auto, cutover and explicit opt-in.
  'nt009-r1': { id: 'nt009-r1', status: 'in_production' },
};

export const DEFAULT_NT009_CUTOVER_AT = '2026-12-01T00:00:00-03:00';
export type ConfiguredDpsLayout = DpsLayout['id'] | 'auto';
export interface DpsLayoutPolicy {
  readonly cutoverAt?: string;
  readonly productionEnabled?: boolean;
}

/** Resolve for each emission, using its dhEmi rather than process startup time. */
export function resolveDpsLayout({
  configured,
  sefinEnvironment,
  cutoverAt = DEFAULT_NT009_CUTOVER_AT,
  productionEnabled = false,
  at,
}: DpsLayoutPolicy & {
  configured: ConfiguredDpsLayout;
  sefinEnvironment: 'production' | 'restricted';
  at: Date;
}): DpsLayout['id'] {
  if (configured !== 'auto') return configured;
  if (sefinEnvironment === 'restricted') return 'nt009-r1';
  return productionEnabled && at.getTime() >= new Date(cutoverAt).getTime()
    ? 'nt009-r1'
    : 'rtc-v1.01';
}
