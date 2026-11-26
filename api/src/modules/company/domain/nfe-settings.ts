/** 1 = Simples Nacional, 4 = Simples Nacional MEI (the only regimes of the NF-e phase 1). */
export type Crt = 1 | 4;
export type NfeCsosn = '102' | '400';

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
  crt: Crt;
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
