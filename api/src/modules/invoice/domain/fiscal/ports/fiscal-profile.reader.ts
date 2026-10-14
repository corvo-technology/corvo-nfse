import type { CompanyFiscalProfile } from '@/modules/company/domain/fiscal-profile';

/**
 * Domain port for reading the company fiscal profiles that are effective on a
 * given date. Implemented by a thin adapter in modules/company and bound with
 * `useExisting` in the fiscal steps wiring.
 */
export abstract class IFiscalProfileReader {
  /**
   * Returns every fiscal profile of the company effective on `date`
   * (YYYY-MM-DD). Zero results mean no profile is effective; more than one
   * result means overlapping validity ranges (a data bug).
   */
  abstract findEffectiveByDate(
    companyId: string,
    tenantId: string,
    date: string,
  ): Promise<CompanyFiscalProfile[]>;
}
