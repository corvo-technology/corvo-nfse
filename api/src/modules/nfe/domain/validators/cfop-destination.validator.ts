import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '../nfe-draft';

/** CFOP has 4 digits and starts with 5 inside the issuer's UF (idDest 1) or 6 outside it (idDest 2). */
export const cfopDestinationValidator: PreSendValidator<NfeDraft> = {
  name: 'cfop-destination',
  validate(draft) {
    const first = String(draft.idDest === 1 ? 5 : 6);
    return draft.items.flatMap((item, index) =>
      new RegExp(`^${first}\\d{3}$`).test(item.cfop)
        ? []
        : [
            {
              field: `items[${index}].cfop`,
              code: 'CFOP_DESTINATION_MISMATCH',
              message: `The CFOP must have 4 digits and start with ${first} for this destination`,
            },
          ],
    );
  },
};
