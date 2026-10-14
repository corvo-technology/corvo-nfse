export interface CatalogFile {
  kind: 'ctribnac';
  version: string;
  sourceUrl: string;
  publishedAt: string;
  checksum: string;
  entries: Array<{ code: string; description: string }>;
}

export interface CatalogLookup {
  version: string;
  found: boolean;
}

export type ClassificationValidationResult =
  | { status: 'validated'; versions: Record<string, string> }
  | { status: 'unavailable'; reason: string }
  | { status: 'invalid'; issues: Array<{ field: string; reason: string }> }
  | { status: 'ambiguous'; candidates: Array<Record<string, string>> };

export abstract class IFiscalCatalog {
  abstract lookupServiceCode(code: string): CatalogLookup;
  abstract validateClassification(
    input: {
      serviceCode: string;
      nbsCode: string | null;
      cst: string | null;
      classCode: string | null;
      operationIndicator: string | null;
    },
    date: string,
  ): ClassificationValidationResult;
}
