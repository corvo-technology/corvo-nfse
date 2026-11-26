import type { ConfigService } from '@nestjs/config';
import { UF_TABLE, isUf } from '@/infra/external/nfe/sefaz/uf';
import type { Company } from '@/modules/company/domain/company';
import type { NfeSettings } from '@/modules/company/domain/nfe-settings';
import type { Uf } from '@/modules/fiscal-core/domain/ports/authority.port';
import type { NfeRespTec } from '../domain/builder/context';
import type { NfeIssuer } from '../domain/nfe-draft';
import { nfeConfigurationError } from './nfe-errors';

/** The issuer as the XML needs it. `settings` and the address were already checked by the preconditions. */
export function nfeIssuerOf(
  company: Company,
  settings: NfeSettings | null,
): NfeIssuer & { uf: Uf } {
  const uf = company.addressState?.trim().toUpperCase() ?? '';
  if (!settings || !isUf(uf) || !company.addressCity?.trim())
    throw nfeConfigurationError({
      code: 'COMPANY_NFE_INCOMPLETE',
      message: 'Complete o cadastro da empresa para emitir NF-e',
      details: { missing: ['address_city'] },
    });
  return {
    cnpj: company.taxId.replace(/[.\s/-]/g, '').toUpperCase(),
    legalName: company.legalName,
    tradeName: company.tradeName ?? null,
    uf,
    cUF: UF_TABLE[uf].cUF,
    stateRegistration: settings.stateRegistration ?? '',
    crt: settings.crt,
    address: {
      street: company.addressStreet ?? '',
      number: company.addressNumber ?? '',
      complement: company.addressComplement ?? null,
      district: company.addressDistrict ?? '',
      zip: (company.addressZip ?? '').replace(/\D/g, ''),
      cityCode: company.municipalityCode ?? '',
      city: company.addressCity,
      state: uf,
    },
  };
}

/** `verProc` (at most 20 characters): the app version, or just "Corvo". */
export function nfeVerProc(config: ConfigService): string {
  const version = config.get<string>('APP_VERSION');
  return version ? `Corvo ${version}`.slice(0, 20) : 'Corvo';
}

/** The four NFE_RESP_TEC_* settings, or nothing when any is empty. */
export function nfeRespTec(config: ConfigService): NfeRespTec | null {
  const get = (key: string) => config.get<string>(key)?.trim() ?? '';
  const tec: NfeRespTec = {
    cnpj: get('NFE_RESP_TEC_CNPJ'),
    contact: get('NFE_RESP_TEC_CONTACT'),
    email: get('NFE_RESP_TEC_EMAIL'),
    phone: get('NFE_RESP_TEC_PHONE'),
  };
  return Object.values(tec).every(Boolean) ? tec : null;
}
