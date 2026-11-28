import type { CadastroAnswer } from '@/infra/external/nfe/sefaz/cadastro';

/** Where a person checks the IE by hand when the SEFAZ consulta is not available. */
export const CCC_URL = 'https://www.sintegra.gov.br/';

/** What the SEFAZ consulta said about the company, in the words the screens and the API use. */
export type RegistrationStatus =
  /** The IE is found, enabled and (when the SEFAZ says) credentialed for the NF-e. */
  | 'ready'
  /** No IE saved yet; the SEFAZ has exactly one enabled IE, so it can be filled in. */
  | 'ie_suggested'
  /** No IE saved yet; the SEFAZ has more than one enabled IE. */
  | 'ie_choose'
  /** The CNPJ has no IE in the UF (a service-only company). */
  | 'no_registration'
  /** The IE exists but is not enabled (or none of them is). */
  | 'not_enabled'
  /** The IE is enabled but the company is not credentialed for the NF-e. */
  | 'not_credentialed'
  /** The saved IE is not one of the IEs of this CNPJ. */
  | 'ie_mismatch'
  /** The UF has no consulta or it did not answer: nothing is known. */
  | 'unavailable'
  /** The SEFAZ answered the consulta with a cStat that is neither "found" nor "not a contributor". */
  | 'sefaz_rejected'
  /** The company has no usable certificate, so the consulta cannot be asked. */
  | 'no_certificate';

export type RegistrationLookup = CadastroAnswer | { kind: 'no_certificate' };

export interface RegistrationAssessment {
  status: RegistrationStatus;
  /** The one enabled IE the SEFAZ has, when there is exactly one. */
  suggested: string | null;
  registrations: { stateRegistration: string; enabled: boolean }[];
  /** Only for `sefaz_rejected`: what the SEFAZ said. */
  sefaz?: { cStat: string; reason: string };
}

/** The answers that say for sure the next note would be refused (or that it cannot be sent). */
export const CONCLUSIVE_STATUSES: readonly RegistrationStatus[] = [
  'ready',
  'no_registration',
  'not_enabled',
  'not_credentialed',
  'ie_mismatch',
];

/** What the last conclusive consulta said, kept with the settings to stop a note before it burns a number. */
export interface RegistrationCheck {
  status: RegistrationStatus;
  checkedAt: Date;
  /** The IE that was saved when the consulta ran. */
  stateRegistration: string;
}

/** How long a saved "not enabled" answer may stop a note. After it, the note goes to the SEFAZ again. */
export const REGISTRATION_CHECK_TTL_MS = 30 * 60 * 1000;

const digits = (value: string): string => value.replace(/\D/g, '');

/** Pure: the consulta answer against the IE saved in the settings (`null` when none). */
export function assessRegistration(
  configured: string | null,
  lookup: RegistrationLookup,
): RegistrationAssessment {
  const empty = { suggested: null, registrations: [] };
  if (lookup.kind === 'no_certificate')
    return { status: 'no_certificate', ...empty };
  if (lookup.kind === 'unavailable') return { status: 'unavailable', ...empty };
  if (lookup.kind === 'rejected')
    return {
      status: 'sefaz_rejected',
      ...empty,
      sefaz: { cStat: lookup.cStat, reason: lookup.reason },
    };
  if (lookup.kind === 'not_found')
    return { status: 'no_registration', ...empty };

  const registrations = lookup.registrations.map((r) => ({
    stateRegistration: r.stateRegistration,
    enabled: r.enabled,
  }));
  const enabled = lookup.registrations.filter((r) => r.enabled);
  const suggested = enabled.length === 1 ? enabled[0].stateRegistration : null;
  const base = { suggested, registrations };

  const ie = configured ? digits(configured) : '';
  if (ie === '') {
    if (enabled.length === 1) return { status: 'ie_suggested', ...base };
    return {
      status: enabled.length > 1 ? 'ie_choose' : 'not_enabled',
      ...base,
    };
  }
  const match = lookup.registrations.find((r) => r.stateRegistration === ie);
  if (!match) return { status: 'ie_mismatch', ...base };
  if (!match.enabled) return { status: 'not_enabled', ...base };
  if (match.nfeCredential === 'no')
    return { status: 'not_credentialed', ...base };
  return { status: 'ready', ...base };
}

export interface RegistrationMessageContext {
  uf: string;
  /** The IE saved in the settings. */
  stateRegistration: string | null;
  suggested?: string | null;
  registrations?: { stateRegistration: string; enabled: boolean }[];
  sefaz?: { cStat: string; reason: string } | null;
}

/** Plain pt-BR sentence of a status. */
export function registrationMessage(
  status: RegistrationStatus,
  context: RegistrationMessageContext,
): string {
  const { uf, stateRegistration: ie } = context;
  switch (status) {
    case 'ready':
      return `IE ${ie ?? ''} encontrada e habilitada para NF-e na SEFAZ de ${uf}.`;
    case 'ie_suggested':
      return `Encontramos a inscrição estadual ${context.suggested ?? ''} na SEFAZ de ${uf}.`;
    case 'ie_choose': {
      const list = (context.registrations ?? [])
        .filter((r) => r.enabled)
        .map((r) => r.stateRegistration)
        .join(', ');
      return `Encontramos mais de uma inscrição estadual habilitada na SEFAZ de ${uf} (${list}). Escolha a da empresa.`;
    }
    case 'no_registration':
      return `Empresa sem inscrição estadual em ${uf}: não pode emitir NF-e nem NFC-e. Se a empresa só presta serviço, use a NFS-e.`;
    case 'not_enabled':
      return ie
        ? `A inscrição estadual ${ie} não está habilitada na SEFAZ de ${uf}. Regularize no site da SEFAZ antes de emitir.`
        : `Nenhuma inscrição estadual habilitada na SEFAZ de ${uf}. Regularize no site da SEFAZ antes de emitir.`;
    case 'not_credentialed':
      return `A empresa não está credenciada para emitir NF-e na SEFAZ de ${uf}. O credenciamento é feito no site da SEFAZ.`;
    case 'ie_mismatch':
      return context.suggested
        ? `A inscrição estadual ${ie ?? ''} não é deste CNPJ na SEFAZ de ${uf}. A encontrada é ${context.suggested}.`
        : `A inscrição estadual ${ie ?? ''} não é deste CNPJ na SEFAZ de ${uf}. Confira o número.`;
    case 'unavailable':
      return `Consulta indisponível agora ou neste estado. Confira a inscrição estadual no CCC: ${CCC_URL}`;
    case 'sefaz_rejected':
      return context.sefaz
        ? `A SEFAZ respondeu: ${context.sefaz.cStat}${context.sefaz.reason ? ` – ${context.sefaz.reason}` : ''}`
        : `A SEFAZ de ${uf} recusou a consulta. Confira a inscrição estadual no CCC: ${CCC_URL}`;
    case 'no_certificate':
      return 'Envie o certificado digital da empresa para consultar a inscrição estadual na SEFAZ.';
  }
}

/**
 * Does the last consulta stop the note? Only a fresh, conclusive "no" for the IE that is saved now:
 * an old answer, another IE or a consulta that did not work never stops anything (the SEFAZ decides).
 * The NFC-e has its own credenciamento that the consulta does not show, so `not_credentialed` stops
 * the NF-e only.
 */
export function registrationBlocks(
  check: RegistrationCheck | null | undefined,
  stateRegistration: string | null,
  model: 55 | 65,
  now: Date = new Date(),
): RegistrationStatus | null {
  if (!check || !stateRegistration) return null;
  if (digits(check.stateRegistration) !== digits(stateRegistration))
    return null;
  if (now.getTime() - check.checkedAt.getTime() > REGISTRATION_CHECK_TTL_MS)
    return null;
  if (check.status === 'ready' || !CONCLUSIVE_STATUSES.includes(check.status))
    return null;
  if (check.status === 'not_credentialed' && model === 65) return null;
  return check.status;
}
