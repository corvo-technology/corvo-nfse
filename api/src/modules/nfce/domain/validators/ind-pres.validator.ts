import type { PreSendValidator } from '@/modules/fiscal-core/application/emission-pipeline';
import type { NfeDraft } from '@/modules/nfe/domain/nfe-draft';

/** The NFC-e is a presential sale: `indPres` is 1, 4 (delivery) or 5. */
export const indPresValidator: PreSendValidator<NfeDraft> = {
  name: 'nfce-ind-pres',
  validate(draft) {
    return [1, 4, 5].includes(draft.indPres)
      ? []
      : [
          {
            field: 'indPres',
            code: 'NFCE_IND_PRES_INVALID',
            message: 'indPres must be 1, 4 or 5 on a NFC-e',
          },
        ];
  },
};
