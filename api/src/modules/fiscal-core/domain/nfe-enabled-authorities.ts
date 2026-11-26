export interface NfeEnabledAuthorities {
  /** True only for a UF x model x environment that passed the homologation roteiro. */
  isEnabled(uf: string, model: 55 | 65, tpAmb: 1 | 2): Promise<boolean>;
}

export const NFE_ENABLED_AUTHORITIES = Symbol('NFE_ENABLED_AUTHORITIES');
