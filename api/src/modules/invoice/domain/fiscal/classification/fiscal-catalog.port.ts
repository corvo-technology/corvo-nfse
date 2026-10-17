/**
 * Fiscal catalog consulted during classification.
 *
 * `lookupServiceCode` resolves the local cTribNac catalog synchronously;
 * `validateClassification` consults the remote calculator with the invoice
 * competence date and therefore returns a promise.
 */
export interface CatalogFile {
  readonly kind: 'ctribnac';
  readonly version: string;
  readonly sourceUrl: string;
  readonly publishedAt: string;
  readonly checksum: string;
  readonly entries: ReadonlyArray<{ code: string; description: string }>;
}

export interface CatalogLookup {
  readonly version: string;
  readonly found: boolean;
}

export interface ClassificationInput {
  readonly serviceCode: string;
  readonly nbsCode: string | null;
  readonly cst: string | null;
  readonly classCode: string | null;
  readonly operationIndicator: string | null;
}

export type ClassificationValidation =
  | { readonly status: 'validated'; readonly versions: Record<string, string> }
  | {
      readonly status: 'unavailable';
      readonly reason: string;
      /**
       * `true` when the failure is a motor outage (retry later);
       * `false` when validation cannot run for structural reasons and the
       * pipeline must fall back to the current non-blocking behavior.
       */
      readonly transient: boolean;
    }
  | {
      readonly status: 'invalid';
      readonly issues: ReadonlyArray<{
        readonly field: string;
        readonly reason: string;
      }>;
    }
  | {
      readonly status: 'ambiguous';
      readonly candidates: ReadonlyArray<{
        readonly cst: string;
        readonly classCode: string;
      }>;
    };

/** @deprecated Use `ClassificationValidation`; kept for existing importers. */
export type ClassificationValidationResult = ClassificationValidation;

export abstract class IFiscalCatalog {
  abstract lookupServiceCode(code: string): CatalogLookup;
  abstract validateClassification(
    input: ClassificationInput,
    date: string,
  ): Promise<ClassificationValidation>;
}
