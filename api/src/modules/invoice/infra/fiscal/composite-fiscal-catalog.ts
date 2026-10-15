import {
  IFiscalCatalog,
  type CatalogLookup,
  type ClassificationInput,
  type ClassificationValidation,
} from '@/modules/invoice/domain/fiscal/classification/fiscal-catalog.port';

/**
 * Fiscal catalog composition: `lookupServiceCode` always resolves against the
 * local cTribNac JSON catalog, while `validateClassification` consults the RTC
 * calculator. Without a configured calculator the validation is unavailable
 * (non-transient), which keeps the current behavior: classification proceeds
 * with `catalogValidated=false` and the warning.
 */
export class CompositeFiscalCatalog extends IFiscalCatalog {
  constructor(
    private readonly local: Pick<IFiscalCatalog, 'lookupServiceCode'>,
    private readonly rtc: Pick<IFiscalCatalog, 'validateClassification'> | null,
  ) {
    super();
  }

  lookupServiceCode(code: string): CatalogLookup {
    return this.local.lookupServiceCode(code);
  }

  validateClassification(
    input: ClassificationInput,
    date: string,
  ): Promise<ClassificationValidation> {
    if (this.rtc === null) {
      return Promise.resolve({
        status: 'unavailable',
        reason: 'RTC calculator is not configured',
        transient: false,
      });
    }
    return this.rtc.validateClassification(input, date);
  }
}
