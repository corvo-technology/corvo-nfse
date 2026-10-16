export type Obligation =
  | { readonly status: 'REQUIRED' }
  | { readonly status: 'NOT_APPLICABLE'; readonly reason: string }
  | { readonly status: 'UNSUPPORTED'; readonly reason: string }
  | {
      readonly status: 'MISSING_CONFIGURATION';
      readonly reason: string;
      readonly missingFields: readonly string[];
    };

export interface TaxApplicability {
  readonly strategy: string;
  readonly customerRequired: boolean;
  readonly iss: Obligation;
  readonly issWithheld: Obligation;
  readonly federalWithholding: Obligation;
  readonly cbs: Obligation;
  readonly ibs: Obligation;
  readonly specialTreatment: Obligation;
  readonly collectionWaived: boolean;
  readonly rulesVersion: string;
  readonly legalReferences: readonly string[];
}
