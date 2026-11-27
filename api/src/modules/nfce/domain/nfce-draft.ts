import type { ExecutionEnvironment } from '@/shared/domain/execution-environment';
import type { NfeRecipient } from '@/modules/nfe/domain/nfe-document';
import {
  buildDraftBody,
  type NfeDraft,
  type NfeDraftSettings,
  type NfeIssuer,
} from '@/modules/nfe/domain/nfe-draft';
import type { NfceInput, NfceRecipientInput } from './nfce-input';

const orNull = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};
const digits = (value: string): string => value.replace(/\D/g, '');
const taxIdOf = (value: string): string =>
  value.replace(/[.\s/-]/g, '').toUpperCase();

/**
 * The consumer as stored: null when nothing identifies or reaches them. A consumer is never a
 * contributor (`indIeDest` 9) and the address is optional (the CPF alone is enough).
 */
function recipientOf(
  input: NfceRecipientInput | undefined,
): NfeRecipient | null {
  if (!input) return null;
  const taxId = taxIdOf(input.taxId ?? '');
  const name = input.name?.trim() ?? '';
  const email = orNull(input.email);
  const a = input.address;
  if (!taxId && !name && !email && !a) return null;
  return {
    taxId,
    name,
    indIeDest: 9,
    stateRegistration: null,
    email,
    address: a
      ? {
          street: a.street.trim(),
          number: a.number.trim(),
          complement: orNull(a.complement),
          district: a.district.trim(),
          zip: digits(a.zip),
          cityCode: a.cityCode.trim(),
          city: a.city.trim(),
          state: a.state.trim().toUpperCase(),
        }
      : null,
  };
}

/**
 * The normalized NFC-e: the items, taxes, totals and payments of the NF-e draft, with the fixed
 * fields of model 65. It is always a sale inside the issuer's UF to a final consumer.
 */
export function buildNfceDraft(
  input: NfceInput,
  issuer: NfeIssuer,
  settings: NfeDraftSettings,
  environment: ExecutionEnvironment,
): NfeDraft {
  const body = buildDraftBody(input, settings);
  return {
    ...body,
    model: 65,
    environment,
    issuer,
    finNfe: 1,
    tpImp: 4,
    indPres: input.indPres ?? 1,
    indFinal: 1,
    idDest: 1,
    recipient: recipientOf(input.recipient),
  };
}
