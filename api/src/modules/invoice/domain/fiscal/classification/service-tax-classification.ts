import type {
  IssTaxation,
  OperationNature,
  WithholdingPolicy,
  WithholdingRates,
} from '@/modules/company/domain/service-tax-profile';
import type { DecimalString } from '../money';

export type ClassificationSource =
  'request_override' | 'company_service_profile' | 'official_catalog';

export interface ServiceTaxClassification {
  serviceCode: string;
  municipalServiceCode: string | null;
  nbsCode: string | null;
  cst: string | null;
  classCode: string | null;
  operationIndicator: string | null;
  source: ClassificationSource;
  serviceProfileId: string | null;
  operationNature: OperationNature;
  iss: {
    taxation: IssTaxation | null;
    rate: DecimalString | null;
    withholdingDefault: boolean;
    incidenceMunicipalityCode: string | null;
  };
  withholding: { policy: WithholdingPolicy; rates: WithholdingRates };
  catalogVersions: Record<string, string>;
  catalogValidated: boolean;
  justification: string;
}
