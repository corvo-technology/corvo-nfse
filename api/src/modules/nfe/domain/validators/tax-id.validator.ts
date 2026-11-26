import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import { isValidCnpj } from '@/shared/fiscal/cnpj';
import { isValidCpf } from '@/shared/fiscal/cpf';
import type { NfeDraft } from '../nfe-draft';

/** CPF (11) or CNPJ (14, alphanumeric allowed) of the recipient, with check digits. */
export const taxIdValidator: PreSendValidator<NfeDraft> = {
  name: 'tax-id',
  validate(draft) {
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
