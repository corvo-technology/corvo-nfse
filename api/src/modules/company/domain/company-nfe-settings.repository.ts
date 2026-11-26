import type { NfeSettings, NfeSettingsInput } from './nfe-settings';

export abstract class ICompanyNfeSettingsRepository {
  /** The `crt` is the stored override, or else the one that follows the open fiscal profile of the company. */
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
