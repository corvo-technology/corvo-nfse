/** 1 = Simples Nacional, 4 = Simples Nacional MEI (the only regimes of the NF-e phase 1). */
export type Crt = 1 | 4;
export type NfeCsosn = '102' | '400';

/**
 * The CRT that follows the company's tax regime (its fiscal profile): MEI is 4 and Simples
 * Nacional is 1. Any other regime has no NF-e CRT in phase 1, so the answer is null.
 */
export function crtForRegime(taxRegime: string | null | undefined): Crt | null {
  if (taxRegime === 'MEI') return 4;
  if (taxRegime === 'SIMPLES_NACIONAL') return 1;
  return null;
}

export interface NfeSettings {
  companyId: string;
  tenantId: string;
  stateRegistration: string | null;
  crt: Crt | null;
  defaultSeries: number;
  defaultNatOp: string;
  defaultCsosn: NfeCsosn;
  defaultOrigin: number;
  defaultPisCst: string;
  defaultCofinsCst: string;
  enabledAt: Date | null;
}

/** What the customer may set. CSC and contingency are reserved for later phases. */
export interface NfeSettingsInput {
  stateRegistration: string;
  /** Only an override: left out, the CRT follows the tax regime of the company. */
  crt?: Crt | null;
  defaultSeries?: number;
  defaultNatOp?: string;
  defaultCsosn?: NfeCsosn;
  defaultOrigin?: number;
  defaultPisCst?: string;
  defaultCofinsCst?: string;
}

export const NFE_SETTINGS_DEFAULTS = {
  defaultSeries: 1,
  defaultNatOp: 'Venda de mercadoria',
  defaultCsosn: '102' as NfeCsosn,
  defaultOrigin: 0,
  defaultPisCst: '49',
  defaultCofinsCst: '49',
} as const;
