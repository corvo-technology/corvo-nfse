import type { TaxRegimeKind } from './fiscal-profile';

/** What the public CNPJ registry says today about the company. `null` fields are unknown. */
export interface RegistryInfo {
  optanteSimples: boolean | null;
  optanteMei: boolean | null;
  /** 7-digit IBGE code of the address registered in the CNPJ. */
  municipalityCode: string | null;
}

export interface RegistryWarning {
  code: 'TAX_REGIME_REGISTRY_MISMATCH' | 'MEI_MUNICIPALITY_MISMATCH';
  message: string;
}

/** The public registry lags behind real changes: these are warnings, never refusals. The Sefin (E0160, E0041) decides. */
export abstract class SimplesRegistryPort {
  /** Null when the registry is unavailable or the CNPJ is unknown. Never throws. */
  abstract lookup(cnpj: string): Promise<RegistryInfo | null>;
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
