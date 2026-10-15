import {
  CatalogFile,
  CatalogLookup,
  ClassificationValidation,
  IFiscalCatalog,
} from './fiscal-catalog.port';

export class JsonFiscalCatalog extends IFiscalCatalog {
  private readonly codes = new Map<string, string>();
  constructor(private readonly file: CatalogFile) {
    super();
    for (const entry of file.entries) {
      if (!/^\d{6}$/.test(entry.code))
        throw new Error(`Invalid cTribNac code: ${entry.code}`);
      if (this.codes.has(entry.code))
        throw new Error(`Duplicate cTribNac code: ${entry.code}`);
      this.codes.set(entry.code, entry.description);
    }
  }
  lookupServiceCode(code: string): CatalogLookup {
    return {
      version: this.file.version,
      found: /^\d{6}$/.test(code) && this.codes.has(code),
    };
  }
  validateClassification(
    _input: Parameters<IFiscalCatalog['validateClassification']>[0],
    _date: string,
  ): Promise<ClassificationValidation> {
    return Promise.resolve({
      status: 'unavailable',
      reason: 'NBS/CST/cClassTrib/cIndOp catalogs are not loaded yet (Spec 3)',
      transient: false,
    });
  }
}
