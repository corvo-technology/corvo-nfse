import type { TaxRule } from '../tax-rule';

export const RULES_VERSION = '2026.10-r1';

/**
 * Versioned fiscal rules as code.
 *
 * Every value below was checked against the official sources listed in
 * docs/fiscal/rules-verification.md (consulted 2026-10-14):
 * - ibscbs.test-phase: LC 214/2025 arts. 343 (IBS 0,1%), 346 (CBS 0,9%) and
 *   348 § 1º (dispensa de recolhimento) / III, "c" (Simples Nacional excluded);
 * - nfse.ibscbs-information: Ato Conjunto RFB/CGIBS nº 4/2026 art. 1º, III and
 *   the SE/CGNFS-e orientation of 07/08/2026 (non-rejection until 31/12/2026);
 *   specificCategoryServiceCodes stays empty because the official act defines
 *   the specific categories by LC 116 subitem numbers and operation nature,
 *   not by 6-digit service codes (see the verification document);
 * - simples.ibscbs-effective: Ato Conjunto RFB/CGIBS nº 4/2026 § 1º, LC 214/2025
 *   Simples annexes (vigência 1º/1/2027) and Resolução CGSN nº 190/2026;
 * - rounding.default: internal computational convention, not legally verified.
 */
export const TAX_RULES: readonly TaxRule[] = [
  {
    ruleKey: 'ibscbs.test-phase',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    legalReference: 'LC 214/2025 (fase de teste 2026)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    status: 'in_production',
    parameters: {
      cbsNominalPercent: '0.9',
      ibsNominalPercent: '0.1',
      collectionWaived: true,
      excludesSimplesNacional: true,
    },
  },
  {
    ruleKey: 'nfse.ibscbs-information',
    validFrom: '2026-10-01',
    validUntil: null,
    legalReference:
      'Ato Conjunto RFB/CGIBS nº 4/2026; orientação CGNFS-e de 07/08/2026',
    sourceUrl:
      'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc',
    status: 'published',
    parameters: {
      generalFrom: '2026-10-01',
      specificCategoriesFrom: '2026-12-01',
      sefinToleranceUntil: '2026-12-31',
      specificCategoryServiceCodes: [],
    },
  },
  {
    ruleKey: 'simples.ibscbs-effective',
    validFrom: '2027-01-01',
    validUntil: null,
    legalReference: 'LC 214/2025 e LC 227/2026 (Simples Nacional)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    status: 'homologated',
    parameters: { effectiveFrom: '2027-01-01' },
  },
  {
    ruleKey: 'rounding.default',
    validFrom: '2026-01-01',
    validUntil: null,
    legalReference: 'Convenção interna (pendente de confirmação fiscal)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    status: 'published',
    parameters: { mode: 'HALF_UP', places: 2 },
  },
  {
    ruleKey: 'reconciliation.tolerance',
    validFrom: '2026-01-01',
    validUntil: null,
    legalReference: 'Convenção interna (pendente de confirmação fiscal E3)',
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm',
    status: 'published',
    parameters: { absolute: '0.01' },
  },
];
