/**
 * Monthly rates of a Simples Nacional company, informed by the company (or its
 * accountant): Corvo does not compute the DAS. `totalRate` is the approximate
 * total tax rate sent as `pTotTribSN`; `issRate` replaces the ISS rate of the
 * fiscal profile for withholding. The IBS and CBS of the Simples (2027) are computed by the
 * national system, so they are not informed here.
 */
export interface SimplesRate {
  companyId: string;
  /** Competence month, `YYYY-MM`. */
  month: string;
  totalRate: string;
  issRate: string | null;
  updatedAt: Date;
}

export interface SimplesRateInput {
  totalRate: string;
  issRate?: string | null;
}

export abstract class ISimplesRateRepository {
  /** Creates the month or replaces it. */
  abstract upsert(
    companyId: string,
    tenantId: string,
    month: string,
    input: SimplesRateInput,
  ): Promise<SimplesRate>;
  /** Newest month first. */
  abstract list(companyId: string, tenantId: string): Promise<SimplesRate[]>;
  /** The latest informed month that is not after `month`. */
  abstract findAtOrBefore(
    companyId: string,
    tenantId: string,
    month: string,
  ): Promise<SimplesRate | null>;
}
