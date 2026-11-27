import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';

/** A delivery sale (`indPres` 4) names the consumer: CPF/CNPJ, name and address. */
export const deliveryAddressValidator: PreSendValidator<NfeDraft> = {
  name: 'nfce-delivery-address',
  validate(draft) {
    if (draft.indPres !== 4) return [];
    const { recipient } = draft;
    return recipient?.taxId && recipient.name && recipient.address
      ? []
      : [
          {
            field: 'recipient',
            code: 'NFCE_DELIVERY_ADDRESS_REQUIRED',
            message:
              'A delivery sale (indPres 4) needs the consumer CPF or CNPJ, name and address',
          },
        ];
  },
};
