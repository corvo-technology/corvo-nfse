import type { NfeSettings, NfeSettingsInput } from './nfe-settings';

export abstract class ICompanyNfeSettingsRepository {
  abstract find(
    companyId: string,
    tenantId: string,
  ): Promise<NfeSettings | null>;
  /** Creates the row or replaces the customer-editable fields; reserved columns are never touched. */
  abstract upsert(
    companyId: string,
    tenantId: string,
    input: Required<NfeSettingsInput>,
  ): Promise<NfeSettings>;
}
