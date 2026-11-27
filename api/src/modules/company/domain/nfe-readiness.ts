import type { Company } from './company';
import type { NfeSettings } from './nfe-settings';

export type NfeMissingField =
  | 'address_street'
  | 'address_number'
  | 'address_district'
  | 'address_zip'
  | 'address_city_code'
  | 'address_state'
  | 'state_registration'
  | 'crt';

const blank = (value: string | null | undefined): boolean =>
  value === undefined || value === null || value.trim() === '';

/** What the company still lacks to issue an NF-e. Only the NF-e is blocked; the NFS-e is unaffected. */
export function nfeReadinessMissing(
  company: Company,
  settings: NfeSettings | null,
): NfeMissingField[] {
  const missing: NfeMissingField[] = [];
  if (blank(company.addressStreet)) missing.push('address_street');
  if (blank(company.addressNumber)) missing.push('address_number');
  if (blank(company.addressDistrict)) missing.push('address_district');
  if (blank(company.addressZip)) missing.push('address_zip');
  if (blank(company.municipalityCode)) missing.push('address_city_code');
  if (blank(company.addressState)) missing.push('address_state');
  if (blank(settings?.stateRegistration)) missing.push('state_registration');
  // With no settings yet the IE is already listed; the CRT follows the tax regime, so it only
  // counts as missing when the settings exist and the regime has no CRT (anything but Simples/MEI).
  if (settings && (settings.crt === null || settings.crt === undefined))
    missing.push('crt');
  return missing;
}
