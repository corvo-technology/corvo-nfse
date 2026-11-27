import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import { isValidCnpj } from '@/shared/fiscal/cnpj';
import { isValidCpf } from '@/shared/fiscal/cpf';
import type { NfeDraft } from '../nfe-draft';

/** CPF (11) or CNPJ (14, alphanumeric allowed) of the recipient, with check digits. */
export const taxIdValidator: PreSendValidator<NfeDraft> = {
  name: 'tax-id',
  validate(draft) {
    // A NFC-e consumer may give no CPF at all (the consumer-id validator decides when it is needed).
    if (!draft.recipient) return [];
    if (draft.model === 65 && draft.recipient.taxId === '') return [];
    const { taxId } = draft.recipient;
    const valid =
      (taxId.length === 11 && isValidCpf(taxId)) ||
      (taxId.length === 14 && isValidCnpj(taxId));
    return valid
      ? []
      : [
          {
            field: 'recipient.taxId',
            code: 'TAX_ID_INVALID',
            message: 'The recipient CPF or CNPJ is not valid',
          },
        ];
  },
};
