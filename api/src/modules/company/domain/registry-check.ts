import type { TaxRegimeKind } from './fiscal-profile';

/** What the public CNPJ registry says today about the company. `null` fields are unknown. */
export interface RegistryInfo {
  optanteSimples: boolean | null;
  optanteMei: boolean | null;
  /** 7-digit IBGE code of the address registered in the CNPJ. */
  municipalityCode: string | null;
}

/** Registration data of a CNPJ, in a neutral shape any form can use to pre-fill itself. Empty text means unknown. */
export interface CnpjProfile {
  legalName: string;
  tradeName: string;
  address: {
    zip: string;
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
  };
  /** 7-digit IBGE code of the registered address, or null when unknown. */
  municipalityCode: string | null;
  simples: boolean | null;
  mei: boolean | null;
  /** False when the registry says the CNPJ is not active (suspended, unfit, closed). */
  active: boolean;
  /** Situation text from the registry (for example ATIVA, BAIXADA). */
  situation: string;
  /** Main activity (CNAE, 7 digits), or null when the registry does not send it. */
  cnae: CnaeActivity | null;
  /** Other activities of the company. */
  secondaryCnaes: CnaeActivity[];
  /** Default service code that fits the main activity, to suggest (never to apply by itself). Null when unsure. */
  suggestedServiceCode: { code: string; description: string } | null;
}

export interface CnaeActivity {
  code: string;
  description: string;
}

/** `not_found`: the registry answered and does not know the CNPJ. `unavailable`: it did not answer (down, rate limited). */
export type CnpjProfileResult =
  | { status: 'found'; profile: CnpjProfile }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export interface RegistryWarning {
  code: 'TAX_REGIME_REGISTRY_MISMATCH' | 'MEI_MUNICIPALITY_MISMATCH';
  message: string;
}

/** The public registry lags behind real changes: these are warnings, never refusals. The Sefin (E0160, E0041) decides. */
export abstract class SimplesRegistryPort {
  /** Null when the registry is unavailable or the CNPJ is unknown. Never throws. */
  abstract lookup(cnpj: string): Promise<RegistryInfo | null>;
  /** Full registration data for pre-filling forms. Same cache and rules as `lookup`, but says whether the CNPJ is unknown or the registry is down. */
  abstract lookupProfile(cnpj: string): Promise<CnpjProfileResult>;
}

export function registryWarnings(
  info: RegistryInfo | null,
  regime: TaxRegimeKind,
  municipalityCode: string | undefined,
): RegistryWarning[] {
  if (info === null) return [];
  const warnings: RegistryWarning[] = [];
  if (regime === 'MEI') {
    if (info.optanteMei === false)
      warnings.push({
        code: 'TAX_REGIME_REGISTRY_MISMATCH',
        message:
          'The public CNPJ registry does not list this company as MEI. The Sefin checks the Simples Nacional registry on the competence date (E0160).',
      });
    if (
      info.municipalityCode !== null &&
      municipalityCode !== undefined &&
      info.municipalityCode !== municipalityCode
    )
      warnings.push({
        code: 'MEI_MUNICIPALITY_MISMATCH',
        message: `A MEI must issue in the municipality of its CNPJ address (${info.municipalityCode}); the company was registered with ${municipalityCode} (E0041).`,
      });
  } else if (regime === 'SIMPLES_NACIONAL') {
    if (info.optanteMei === true || info.optanteSimples === false)
      warnings.push({
        code: 'TAX_REGIME_REGISTRY_MISMATCH',
        message:
          info.optanteMei === true
            ? 'The public CNPJ registry lists this company as MEI, not as ME/EPP of the Simples Nacional.'
            : 'The public CNPJ registry does not list this company as optante of the Simples Nacional (E0160).',
      });
  }
  return warnings;
}
